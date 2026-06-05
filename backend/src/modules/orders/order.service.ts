import mongoose, { Types } from 'mongoose';
import { Order, IOrder, OrderStatus, STATUS_TRANSITIONS } from './order.model';
import { Cart } from '../cart/cart.model';
import { Product } from '../products/product.model';
import { User } from '../auth/user.model';
import { createError } from '../../middleware/errorHandler';
import { IShippingAddress } from './order.model';
import { emailService } from '../../services/email.service';

export async function bulkUpdateOrderStatus(storeId: string, ids: string[], status: OrderStatus): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id));
  if (validIds.length === 0) throw createError('No valid order IDs provided', 400, 'BAD_REQUEST');
  const result = await Order.updateMany(
    { _id: { $in: validIds }, storeId: new Types.ObjectId(storeId) },
    { status }
  );
  return result.modifiedCount;
}

export async function bulkDeleteOrders(storeId: string, ids: string[]): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id));
  if (validIds.length === 0) throw createError('No valid order IDs provided', 400, 'BAD_REQUEST');
  const result = await Order.deleteMany({
    _id: { $in: validIds },
    storeId: new Types.ObjectId(storeId),
  });
  return result.deletedCount;
}

export interface OrderDoc {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  items: { productId: Types.ObjectId; name: string; price: number; quantity: number }[];
  totalAmount: number;
  status: OrderStatus;
  paymentIntentId?: string;
  shippingAddress: IShippingAddress;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaginatedOrders {
  data: OrderDoc[];
  total: number;
  page: number;
  totalPages: number;
}

export async function placeOrder(
  storeId: string,
  customerId: string,
  shippingAddress: IShippingAddress,
  discountAmount = 0,
  couponCode?: string,
  idempotencyKey?: string
): Promise<OrderDoc> {
  const storeObjId = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);

  // ── Duplicate-order guard (item #9) ────────────────────────────────────────
  // If the client provides an idempotency key (generated at checkout page load),
  // return the existing order immediately on any retry — no second charge or
  // stock decrement will occur.
  if (idempotencyKey) {
    const existing = await Order.findOne({
      storeId: storeObjId,
      customerId: customerObjId,
      idempotencyKey,
    }).lean();
    if (existing) {
      return existing as unknown as OrderDoc;
    }
  }

  // Fallback guard: block a second pending order with the same cart fingerprint
  // within a 5-minute window (catches retries that don't send an idempotency key).
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const recentDuplicate = await Order.findOne({
    storeId: storeObjId,
    customerId: customerObjId,
    status: 'pending',
    createdAt: { $gte: fiveMinutesAgo },
  })
    .select('_id')
    .lean();
  if (recentDuplicate) {
    throw createError(
      'A pending order was placed very recently. Please wait a moment before placing another order, or complete your existing checkout.',
      409,
      'DUPLICATE_ORDER'
    );
  }

  const validateAndBuild = async (session?: mongoose.ClientSession) => {
    const cartQuery = Cart.findOne({ storeId: storeObjId, customerId: customerObjId });
    if (session) cartQuery.session(session);
    const cart = await cartQuery.lean();

    if (!cart || cart.items.length === 0) {
      throw createError('Cart is empty', 400, 'BAD_REQUEST');
    }

    const productIds = cart.items.map((i) => i.productId);
    const productQuery = Product.find({
      _id: { $in: productIds },
      storeId: storeObjId,
      isDeleted: false,
    });
    if (session) productQuery.session(session);
    const products = await productQuery.lean();

    const productMap = new Map(products.map((p) => [p._id.toString(), p]));

    for (const item of cart.items) {
      const product = productMap.get(item.productId.toString());
      if (!product) {
        throw createError(
          `One or more cart items belong to a different store. Please clear your cart and add products from this store.`,
          400, 'BAD_REQUEST'
        );
      }
      if (product.stock < item.quantity) {
        throw createError(
          `Insufficient stock for "${product.name}": requested ${item.quantity}, available ${product.stock}`,
          400, 'BAD_REQUEST'
        );
      }
    }

    let totalAmount = 0;
    const orderItems = cart.items.map((item) => {
      const product = productMap.get(item.productId.toString())!;
      // Use the discounted price — this is what the customer sees and what Stripe charges
      const effectivePrice =
        product.discount > 0
          ? Math.round(product.price * (1 - product.discount / 100) * 100) / 100
          : product.price;
      totalAmount += effectivePrice * item.quantity;
      return {
        productId: item.productId,
        name: product.name,
        price: effectivePrice,   // snapshot the price actually charged at order time
        quantity: item.quantity,
        selectedSize: item.selectedSize ?? undefined,
      };
    });
    totalAmount = Math.round(totalAmount * 100) / 100;

    return { cart, orderItems, totalAmount };
  };

  const session = await mongoose.startSession();
  try {
    let createdOrder: OrderDoc | null = null;

    await session.withTransaction(async () => {
      const { cart, orderItems, totalAmount } = await validateAndBuild(session);
      const finalAmount = Math.max(0, Math.round((totalAmount - discountAmount) * 100) / 100);

      const [order] = await Order.create(
        [{
          storeId: storeObjId,
          customerId: customerObjId,
          items: orderItems,
          totalAmount: finalAmount,
          discountAmount,
          couponCode,
          shippingAddress,
          status: 'pending',
          ...(idempotencyKey && { idempotencyKey }),
        }],
        { session }
      );

      for (const item of cart.items) {
        await Product.updateOne({ _id: item.productId, storeId: storeObjId }, { $inc: { stock: -item.quantity } }, { session });
      }
      await Cart.updateOne({ storeId: storeObjId, customerId: customerObjId }, { $set: { items: [] } }, { session });

      createdOrder = order.toObject() as unknown as OrderDoc;
    });

    if (!createdOrder) throw createError('Order creation failed', 500, 'INTERNAL_ERROR');

    const customer = await User.findById(customerId).lean();
    if (customer?.email) {
      emailService.sendOrderConfirmationEmail(storeId, customer.email, {
        orderId: (createdOrder as any)._id.toString(),
        items: (createdOrder as any).items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
        totalAmount: (createdOrder as any).totalAmount,
        shippingAddress: (createdOrder as any).shippingAddress,
        createdAt: (createdOrder as any).createdAt ?? new Date(),
      });
    }

    return createdOrder;

  } catch (txErr: unknown) {
    const errMsg = (txErr as Error)?.message ?? '';
    const isTransactionUnsupported =
      errMsg.includes('Transaction numbers are only allowed on a replica set') ||
      errMsg.includes('not supported') ||
      errMsg.includes('MongoServerError');

    if (!isTransactionUnsupported) {
      throw txErr;
    }

    // Fallback: non-transactional path for Atlas M0 / standalone
    console.warn('[placeOrder] Transactions not supported — using non-transactional fallback');

    const { cart, orderItems, totalAmount } = await validateAndBuild();
    const finalAmount = Math.max(0, Math.round((totalAmount - discountAmount) * 100) / 100);

    const order = await Order.create({
      storeId: storeObjId,
      customerId: customerObjId,
      items: orderItems,
      totalAmount: finalAmount,
      discountAmount,
      couponCode,
      shippingAddress,
      status: 'pending',
      ...(idempotencyKey && { idempotencyKey }),
    });

    for (const item of cart.items) {
      await Product.updateOne({ _id: item.productId, storeId: storeObjId }, { $inc: { stock: -item.quantity } });
    }
    await Cart.updateOne({ storeId: storeObjId, customerId: customerObjId }, { $set: { items: [] } });

    const fallbackOrder = order.toObject() as unknown as OrderDoc;

    const fallbackCustomer = await User.findById(customerId).lean();
    if (fallbackCustomer?.email) {
      emailService.sendOrderConfirmationEmail(storeId, fallbackCustomer.email, {
        orderId: (fallbackOrder as any)._id.toString(),
        items: (fallbackOrder as any).items.map((i: any) => ({ name: i.name, quantity: i.quantity, price: i.price })),
        totalAmount: (fallbackOrder as any).totalAmount,
        shippingAddress: (fallbackOrder as any).shippingAddress,
        createdAt: (fallbackOrder as any).createdAt ?? new Date(),
      });
    }

    return fallbackOrder;

  } finally {
    session.endSession();
  }
}

export async function getMyOrders(
  storeId: string,
  customerId: string,
  page: number,
  limit: number
): Promise<PaginatedOrders> {
  const skip = (page - 1) * limit;
  const query = {
    storeId: new Types.ObjectId(storeId),
    customerId: new Types.ObjectId(customerId),
  };

  const [data, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('_id storeId customerId items totalAmount discountAmount status createdAt updatedAt shippingAddress')
      .lean(),
    Order.countDocuments(query),
  ]);

  return {
    data: data as unknown as OrderDoc[],
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getMyOrderById(storeId: string, customerId: string, orderId: string): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }

  const order = await Order.findOne({
    _id: orderId,
    storeId: new Types.ObjectId(storeId),
    customerId: new Types.ObjectId(customerId),
  }).lean();

  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');
  return order as unknown as OrderDoc;
}

export async function cancelMyOrder(storeId: string, customerId: string, orderId: string): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }

  const order = await Order.findOne({
    _id: orderId,
    storeId: new Types.ObjectId(storeId),
    customerId: new Types.ObjectId(customerId),
  });

  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');

  if (order.status !== 'pending') {
    throw createError('Only pending orders can be cancelled by the customer', 400, 'BAD_REQUEST');
  }

  order.status = 'cancelled';
  await order.save();
  return order.toObject() as unknown as OrderDoc;
}

export async function getAllOrders(storeId: string, page: number, limit: number, status?: OrderStatus): Promise<PaginatedOrders> {
  const skip = (page - 1) * limit;
  const query: any = { storeId: new Types.ObjectId(storeId) };
  if (status) query.status = status;

  const [data, total] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(query),
  ]);

  return {
    data: data as unknown as OrderDoc[],
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getOrderByIdAdmin(storeId: string, orderId: string): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }
  const order = await Order.findOne({
    _id: orderId,
    storeId: new Types.ObjectId(storeId),
  }).lean();
  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');
  return order as unknown as OrderDoc;
}

export async function updateOrderStatus(
  storeId: string,
  orderId: string,
  newStatus: OrderStatus
): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }

  const order = await Order.findOne({
    _id: orderId,
    storeId: new Types.ObjectId(storeId),
  });
  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');

  const allowed = STATUS_TRANSITIONS[order.status];
  if (!allowed.includes(newStatus)) {
    throw createError(
      `Cannot transition order from "${order.status}" to "${newStatus}"`,
      400,
      'BAD_REQUEST'
    );
  }

  order.status = newStatus;
  await order.save();

  const notifiableStatuses = ['processing', 'shipped', 'delivered', 'cancelled'];
  if (notifiableStatuses.includes(newStatus)) {
    const customer = await User.findById(order.customerId).lean();
    if (customer?.email) {
      emailService.sendOrderStatusEmail(storeId, customer.email, {
        orderId,
        status: newStatus as 'processing' | 'shipped' | 'delivered' | 'cancelled',
        updatedAt: new Date(),
      });
    }
  }

  return order.toObject() as unknown as OrderDoc;
}
