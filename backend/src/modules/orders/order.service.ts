import mongoose, { Types } from 'mongoose';
import { OrderStatus, STATUS_TRANSITIONS, PaymentMethod } from './order.model';
import { User } from '../auth/user.model';
import { createError } from '../../middleware/errorHandler';
import { IShippingAddress } from './order.model';
import { emailService } from '../../services/email.service';
import { logger } from '../../utils/logger';
import * as orderRepo from './order.repository';
import * as productRepo from '../products/product.repository';
import * as cartRepo from '../cart/cart.repository';
import { couponService } from '../coupons/coupon.service';
import { config } from '../../config/index';
import { calculateOrderTotals } from '../checkout/money';
import {
  resolveSelectedRate,
  getShippingOptions,
  countActiveZones,
} from '../shipping/shipping.service';
import { matchTaxRates } from '../tax/tax.service';

export async function bulkUpdateOrderStatus(storeId: string, ids: string[], status: OrderStatus): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  if (validIds.length === 0) throw createError('No valid order IDs provided', 400, 'BAD_REQUEST');
  const result = await orderRepo.bulkUpdateOrderStatuses(validIds, new Types.ObjectId(storeId), status);
  return result.modifiedCount;
}

export async function bulkDeleteOrders(storeId: string, ids: string[]): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  if (validIds.length === 0) throw createError('No valid order IDs provided', 400, 'BAD_REQUEST');
  const result = await orderRepo.deleteOrdersByIds(validIds, new Types.ObjectId(storeId));
  return result.deletedCount;
}

export interface OrderDoc {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  items: { productId: Types.ObjectId; name: string; price: number; quantity: number }[];
  /** Amount charged — grand total including shipping and (if exclusive) tax. */
  totalAmount: number;
  subtotal: number;
  discountAmount: number;
  shippingTotal: number;
  taxTotal: number;
  taxLines: { name: string; rate: number; amount: number; inclusive: boolean }[];
  shippingMethod?: { rateId?: Types.ObjectId; name: string; amount: number };
  currency: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
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
  paymentMethod: PaymentMethod = 'online',
  couponCode?: string,
  idempotencyKey?: string,
  shippingRateId?: string
): Promise<OrderDoc> {
  const storeObjId    = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);

  // Currency is snapshotted onto the order so historical amounts stay
  // interpretable if the store later switches currency.
  const { Store } = await import('../stores/store.model');
  // subscriptionStatus + trialEndsAt are projected alongside the plan because
  // the quota below is resolved from the EFFECTIVE plan, which needs all three.
  // pricesIncludeTax drives whether tax is added to or extracted from the
  // catalogue prices — getting it from the store, never from the request.
  const storeConfig = await Store.findById(storeObjId)
    .select('currency subscriptionPlan subscriptionStatus trialEndsAt pricesIncludeTax')
    .lean();
  const orderCurrency = (storeConfig?.currency ?? 'USD').toUpperCase();
  const pricesIncludeTax = storeConfig?.pricesIncludeTax ?? false;

  // ── Plan quota ─────────────────────────────────────────────────────────────
  // maxOrdersPerMonth was declared on every plan and never read, so a free store
  // could take unlimited orders. Checked before any write so a store over quota
  // does not decrement stock or clear the cart.
  //
  // Resolved from the effective plan so a store whose subscription lapsed drops
  // back to the free allowance instead of keeping its paid one. Note this is a
  // quota, not the access gate: a `suspended` store is refused earlier, by
  // enforceSubscription, before the request ever reaches this service.
  const { getPlanLimits } = await import('../../config/planLimits');
  const { resolveSubscriptionAccess } = await import('../stores/subscription-access');
  const orderLimit = getPlanLimits(
    resolveSubscriptionAccess(storeConfig ?? {}).effectivePlan
  ).maxOrdersPerMonth;

  if (orderLimit !== -1) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const used = await orderRepo.countOrdersSince(storeObjId, startOfMonth);

    if (used >= orderLimit) {
      throw createError(
        `This store has reached its monthly order limit (${orderLimit}). ` +
        `Please contact the store owner — they need to upgrade their plan to accept more orders.`,
        403,
        'PLAN_LIMIT_EXCEEDED'
      );
    }
  }

  // ── Idempotency guard ──────────────────────────────────────────────────────
  if (idempotencyKey) {
    const existing = await orderRepo.findOrderByIdempotencyKey(storeObjId, customerObjId, idempotencyKey);
    if (existing) return existing as unknown as OrderDoc;
  }

  // ── Fallback duplicate guard (5-minute window) ────────────────────────────
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const cartForCheck = await cartRepo.findCart(storeObjId, customerObjId);

  if (cartForCheck && cartForCheck.items.length > 0) {
    const productIdsForCheck = cartForCheck.items.map(i => i.productId);
    const productsForCheck = await productRepo.findProductsByIds(productIdsForCheck, storeObjId);

    const productPriceMap = new Map(productsForCheck.map(p => [p._id.toString(), p]));
    let checkTotal = 0;
    for (const item of cartForCheck.items) {
      const p = productPriceMap.get(item.productId.toString());
      if (p) {
        const effective = p.discount > 0 ? Math.round(p.price * (1 - p.discount / 100) * 100) / 100 : p.price;
        checkTotal += effective * item.quantity;
      }
    }

    // Matched on SUBTOTAL, not the grand total.
    //
    // This used to reconstruct `subtotal − discount` and compare it against
    // `order.totalAmount`. Now that totalAmount also carries shipping and tax,
    // that reconstruction would never match a real order again and the guard
    // would silently stop firing. The subtotal is a stabler identity for "the
    // same basket" anyway: it does not move when the shopper changes delivery
    // method, and it needs no coupon preview to compute.
    checkTotal = Math.round(checkTotal * 100) / 100;

    const recentDuplicate = await orderRepo.findRecentPendingOrder(
      storeObjId, customerObjId, checkTotal, fiveMinutesAgo
    );

    if (recentDuplicate) {
      throw createError(
        'A pending order was placed very recently. Please wait a moment before placing another order, or complete your existing checkout.',
        409,
        'DUPLICATE_ORDER'
      );
    }
  }

  // ── Cart validation and order item building ───────────────────────────────
  const validateAndBuild = async (session?: mongoose.ClientSession) => {
    const { Cart } = await import('../cart/cart.model');
    const cartQuery = Cart.findOne({ storeId: storeObjId, customerId: customerObjId });
    if (session) cartQuery.session(session);
    const cart = await cartQuery.lean();

    if (!cart || cart.items.length === 0) {
      throw createError('Cart is empty', 400, 'BAD_REQUEST');
    }

    const { Product } = await import('../products/product.model');
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

    let subtotal = 0;
    const orderItems = cart.items.map((item) => {
      const product = productMap.get(item.productId.toString())!;
      const effectivePrice =
        product.discount > 0
          ? Math.round(product.price * (1 - product.discount / 100) * 100) / 100
          : product.price;
      subtotal += effectivePrice * item.quantity;
      return {
        productId: item.productId,
        name: product.name,
        price: effectivePrice,
        quantity: item.quantity,
        selectedSize: item.selectedSize ?? undefined,
      };
    });
    subtotal = Math.round(subtotal * 100) / 100;

    return { cart, orderItems, subtotal };
  };

  // ── Server-authoritative discount resolution ──────────────────────────────
  // The discount is NEVER taken from the request. It is recomputed here from the
  // coupon record, and the usage claim is made in the same session as the order
  // so an aborted checkout does not burn a coupon use.
  const resolveDiscount = async (
    subtotal: number,
    session?: mongoose.ClientSession
  ): Promise<number> => {
    if (!couponCode) return 0;
    const applied = await couponService.validateAndApplyCoupon(
      storeId,
      couponCode,
      subtotal,
      session
    );
    // Never let a discount exceed the subtotal — guarantees a non-negative total.
    return Math.min(Math.max(0, applied.discount), subtotal);
  };

  /**
   * Turns validated cart lines into the full money breakdown.
   *
   * Shared by the transactional path and the standalone-MongoDB fallback so the
   * two cannot drift — a divergence here would mean the amount charged depends
   * on the database topology.
   *
   * Order of operations matters:
   *   1. discount is claimed (this is what burns a coupon use)
   *   2. shipping is priced against the DISCOUNTED goods total, so a coupon can
   *      legitimately carry an order over a free-delivery threshold
   *   3. tax is assessed on the destination
   *
   * Nothing here trusts the request: the discount comes from the coupon record,
   * the shipping amount is re-derived from the rate document, and the tax rates
   * come from the merchant's own table keyed on the delivery address.
   */
  const composeTotals = async (
    orderItems: Array<{ price: number; quantity: number }>,
    subtotal: number,
    session?: mongoose.ClientSession
  ) => {
    const discountAmount = await resolveDiscount(subtotal, session);
    const discountedGoods = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);

    // ── Delivery method is mandatory once the merchant configures shipping ──
    //
    // `shippingRateId` is optional on the wire, which on its own would make the
    // entire feature opt-out: omit the field and get free delivery. These two
    // guards close that, while staying backwards compatible.
    //
    //   • store has NO zones at all  → shipping is not configured. Charge
    //     nothing and proceed, exactly as before this feature existed. Every
    //     pre-existing store is in this state.
    //   • store HAS zones but none serves this address → they do not deliver
    //     there. Refuse rather than silently ship for free.
    //   • store serves the address but nothing was chosen → make the shopper
    //     choose instead of defaulting to the cheapest (or to nothing).
    const availableOptions = await getShippingOptions(
      storeObjId,
      shippingAddress,
      discountedGoods
    );

    if (!shippingRateId && availableOptions.length > 0) {
      throw createError('Please choose a delivery method', 400, 'SHIPPING_METHOD_REQUIRED');
    }

    if (availableOptions.length === 0) {
      const configured = await countActiveZones(storeObjId);
      if (configured > 0) {
        throw createError(
          'This store does not deliver to the selected address',
          400,
          'DESTINATION_NOT_SERVED'
        );
      }
    }

    const shipping = await resolveSelectedRate(
      storeObjId,
      shippingAddress,
      discountedGoods,
      shippingRateId
    );
    const taxRates = await matchTaxRates(storeObjId, shippingAddress);

    const totals = calculateOrderTotals({
      items: orderItems.map((i) => ({ unitPrice: i.price, quantity: i.quantity })),
      discountAmount,
      shippingAmount: shipping?.amount ?? 0,
      taxRates,
      pricesIncludeTax,
    });

    return {
      totals,
      shippingMethod: shipping
        ? { rateId: shipping.rateId, name: shipping.name, amount: shipping.amount }
        : undefined,
    };
  };

  const session = await mongoose.startSession();
  try {
    let createdOrder: OrderDoc | null = null;

    await session.withTransaction(async () => {
      const { cart, orderItems, subtotal } = await validateAndBuild(session);
      const { totals, shippingMethod } = await composeTotals(orderItems, subtotal, session);

      const order = await orderRepo.createOrder(
        {
          storeId: storeObjId,
          customerId: customerObjId,
          items: orderItems,
          // `totalAmount` remains the amount CHARGED, so every payment path
          // keeps working untouched — it just now includes shipping and tax.
          totalAmount: totals.grandTotal,
          subtotal: totals.subtotal,
          discountAmount: totals.discountTotal,
          shippingTotal: totals.shippingTotal,
          taxTotal: totals.taxTotal,
          taxLines: totals.taxLines,
          ...(shippingMethod && { shippingMethod }),
          currency: orderCurrency,
          couponCode,
          shippingAddress,
          paymentMethod,
          status: 'pending',
          ...(idempotencyKey && { idempotencyKey }),
        } as any,
        session
      );

      for (const item of cart.items) {
        await productRepo.decrementStock(item.productId, storeObjId, item.quantity, session);
      }
      await orderRepo.clearCartAfterOrder(storeObjId, customerObjId, session);

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

    if (!isTransactionUnsupported) throw txErr;

    // ── Non-transactional fallback (Atlas M0 / standalone MongoDB) ───────────
    logger.warn('[placeOrder] Transactions not supported — using non-transactional fallback');

    const { cart, orderItems, subtotal } = await validateAndBuild();
    const { totals, shippingMethod } = await composeTotals(orderItems, subtotal);

    const order = await orderRepo.createOrder({
      storeId: storeObjId,
      customerId: customerObjId,
      items: orderItems,
      totalAmount: totals.grandTotal,
      subtotal: totals.subtotal,
      discountAmount: totals.discountTotal,
      shippingTotal: totals.shippingTotal,
      taxTotal: totals.taxTotal,
      taxLines: totals.taxLines,
      ...(shippingMethod && { shippingMethod }),
      currency: orderCurrency,
      couponCode,
      shippingAddress,
      paymentMethod,
      status: 'pending',
      ...(idempotencyKey && { idempotencyKey }),
    } as any);

    for (const item of cart.items) {
      await productRepo.decrementStock(item.productId, storeObjId, item.quantity);
    }
    await orderRepo.clearCartAfterOrder(storeObjId, customerObjId);

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
  const { data, total } = await orderRepo.findCustomerOrders(
    new Types.ObjectId(storeId),
    new Types.ObjectId(customerId),
    skip,
    limit
  );
  return { data: data as unknown as OrderDoc[], total, page, totalPages: Math.ceil(total / limit) };
}

export async function getMyOrderById(storeId: string, customerId: string, orderId: string): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }
  const order = await orderRepo.findOrderByIdForCustomer(
    orderId, new Types.ObjectId(storeId), new Types.ObjectId(customerId)
  );
  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');
  return order as unknown as OrderDoc;
}

/**
 * Return every line item's units to stock.
 *
 * Callers MUST only invoke this after an atomic status transition that they won
 * (i.e. transitionOrderStatus returned a document), otherwise a concurrent
 * cancellation could restore the same units twice.
 */
async function restoreStockForOrder(
  items: { productId: Types.ObjectId; quantity: number }[],
  storeObjId: Types.ObjectId
): Promise<void> {
  for (const item of items) {
    await productRepo.restoreStock(item.productId, storeObjId, item.quantity);
  }
}

export async function cancelMyOrder(storeId: string, customerId: string, orderId: string): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }

  const storeObjId = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);

  // Atomic pending -> cancelled. Only one concurrent caller can win, which makes
  // the stock restoration below exactly-once.
  const cancelled = await orderRepo.transitionOrderStatus(
    orderId, storeObjId, 'pending', 'cancelled', customerObjId
  );

  if (!cancelled) {
    // Distinguish "not yours / doesn't exist" from "not cancellable any more".
    const existing = await orderRepo.findOrderByIdForCustomer(orderId, storeObjId, customerObjId);
    if (!existing) throw createError('Order not found', 404, 'NOT_FOUND');
    throw createError('Only pending orders can be cancelled by the customer', 400, 'BAD_REQUEST');
  }

  // Cancelling previously destroyed inventory — the units were decremented at
  // checkout and never returned.
  await restoreStockForOrder(cancelled.items, storeObjId);

  return cancelled.toObject() as unknown as OrderDoc;
}

/**
 * Release inventory held by abandoned online checkouts.
 *
 * placeOrder creates the order and decrements stock BEFORE the customer pays, so
 * a shopper who closes the tab on the payment step leaves an unpayable pending
 * order holding units that never come back. This job cancels those orders and
 * returns their stock.
 *
 * Uses the same atomic pending -> cancelled transition as manual cancellation,
 * so an order that is being paid for concurrently is never stolen, and stock is
 * restored at most once.
 *
 * COD orders are excluded — see findStalePendingOnlineOrders.
 *
 * Exported for direct testing; scheduled from server.ts.
 */
export async function expireStalePendingOrders(
  ttlMinutes: number = config.PENDING_ORDER_TTL_MINUTES
): Promise<number> {
  const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000);
  const stale = await orderRepo.findStalePendingOnlineOrders(cutoff);

  let released = 0;
  for (const candidate of stale) {
    const storeObjId = candidate.storeId as Types.ObjectId;

    // Only the caller that actually performs the transition restores stock.
    const cancelled = await orderRepo.transitionOrderStatus(
      candidate._id.toString(), storeObjId, 'pending', 'cancelled'
    );
    if (!cancelled) continue; // paid or cancelled in the meantime

    await restoreStockForOrder(cancelled.items, storeObjId);
    released++;
  }

  if (released > 0) {
    logger.info('Released inventory from abandoned checkouts', {
      released,
      ttlMinutes,
      cutoff,
    });
  }
  return released;
}

export async function getAllOrders(storeId: string, page: number, limit: number, status?: OrderStatus): Promise<PaginatedOrders> {
  const skip = (page - 1) * limit;
  const { data, total } = await orderRepo.findStoreOrders(
    new Types.ObjectId(storeId), skip, limit, status
  );
  return { data: data as unknown as OrderDoc[], total, page, totalPages: Math.ceil(total / limit) };
}

export async function getOrderByIdAdmin(storeId: string, orderId: string): Promise<OrderDoc> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }
  const order = await orderRepo.findOrderById(orderId, new Types.ObjectId(storeId));
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

  const storeObjId = new Types.ObjectId(storeId);
  const order = await orderRepo.findOrderDocumentById(orderId, storeObjId);
  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');

  // `?? []` guards against a status value outside the enum. Bulk updates now
  // enforce the enum, but a corrupt legacy row would otherwise crash here with
  // "Cannot read properties of undefined (reading 'includes')" -> HTTP 500.
  const allowed = STATUS_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw createError(
      `Cannot transition order from "${order.status}" to "${newStatus}"`,
      400,
      'BAD_REQUEST'
    );
  }

  // Atomic transition guarded on the exact status we validated against, so two
  // concurrent admins cannot both "win" and double-restore stock.
  const updated = await orderRepo.transitionOrderStatus(
    orderId, storeObjId, order.status, newStatus
  );

  if (!updated) {
    throw createError(
      'Order status changed while this request was in flight — please retry',
      409,
      'CONFLICT'
    );
  }

  // Cancelling releases the reserved inventory back to the catalogue.
  if (newStatus === 'cancelled') {
    await restoreStockForOrder(updated.items, storeObjId);
  }

  const notifiableStatuses = ['processing', 'shipped', 'delivered', 'cancelled'];
  if (notifiableStatuses.includes(newStatus)) {
    const customer = await User.findById(updated.customerId).lean();
    if (customer?.email) {
      emailService.sendOrderStatusEmail(storeId, customer.email, {
        orderId,
        status: newStatus as 'processing' | 'shipped' | 'delivered' | 'cancelled',
        updatedAt: new Date(),
      });
    }
  }

  return updated.toObject() as unknown as OrderDoc;
}
