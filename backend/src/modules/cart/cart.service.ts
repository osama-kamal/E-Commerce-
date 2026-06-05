import { Types } from 'mongoose';
import { Cart } from './cart.model';
import { Product } from '../products/product.model';
import { createError } from '../../middleware/errorHandler';

export interface CartItemView {
  productId: Types.ObjectId;
  name: string;
  currentPrice: number;
  quantity: number;
  lineTotal: number;
  selectedSize?: string;
}

export interface CartView {
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  items: CartItemView[];
  subtotal: number;
  updatedAt: Date;
}

async function buildCartView(storeId: string, customerId: string): Promise<CartView> {
  const cart = await Cart.findOne({
    storeId: new Types.ObjectId(storeId),
    customerId: new Types.ObjectId(customerId),
  }).lean();

  if (!cart || cart.items.length === 0) {
    return {
      storeId: new Types.ObjectId(storeId),
      customerId: new Types.ObjectId(customerId),
      items: [],
      subtotal: 0,
      updatedAt: cart?.updatedAt ?? new Date(),
    };
  }

  const productIds = cart.items.map((i) => i.productId);
  const products = await Product.find({
    _id: { $in: productIds },
    isDeleted: false,
    // Note: no storeId filter here — products in the cart already belong to this store.
    // Filtering by storeId would silently drop items if the store context changes.
  })
    .select('name price discount')  // discount must be selected to compute effective price
    .lean();

  const priceMap = new Map(products.map((p) => [p._id.toString(), p]));

  const items: CartItemView[] = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const product = priceMap.get(item.productId.toString());
    if (!product) continue;

    // Apply discount percentage to get the price the customer actually pays
    const effectivePrice =
      product.discount > 0
        ? Math.round(product.price * (1 - product.discount / 100) * 100) / 100
        : product.price;

    const lineTotal = effectivePrice * item.quantity;
    subtotal += lineTotal;
    items.push({
      productId: item.productId,
      name: product.name,
      currentPrice: effectivePrice,
      quantity: item.quantity,
      lineTotal: Math.round(lineTotal * 100) / 100,
      selectedSize: item.selectedSize ?? undefined,
    });
  }

  return {
    storeId: cart.storeId,
    customerId: cart.customerId,
    items,
    subtotal: Math.round(subtotal * 100) / 100,
    updatedAt: cart.updatedAt,
  };
}

export async function getCart(storeId: string, customerId: string): Promise<CartView> {
  return buildCartView(storeId, customerId);
}

export async function addItem(
  storeId: string,
  customerId: string,
  productId: string,
  quantity: number,
  selectedSize?: string
): Promise<CartView> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const product = await Product.findOne({
    _id: productId,
    storeId: new Types.ObjectId(storeId),
    isDeleted: false,
  }).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  if (product.stock <= 0) throw createError('Product is out of stock', 400, 'BAD_REQUEST');

  const cart = await Cart.findOne({
    storeId: new Types.ObjectId(storeId),
    customerId: new Types.ObjectId(customerId),
  }).lean();

  const existingItem = cart?.items.find(
    (i) => i.productId.toString() === productId && i.selectedSize === (selectedSize ?? null)
  );
  const currentQty = existingItem?.quantity ?? 0;
  const newQty = currentQty + quantity;

  if (newQty > product.stock) {
    throw createError(
      `Only ${product.stock} unit(s) available (you already have ${currentQty} in cart)`,
      400,
      'BAD_REQUEST'
    );
  }

  if (existingItem) {
    await Cart.updateOne(
      {
        storeId: new Types.ObjectId(storeId),
        customerId: new Types.ObjectId(customerId),
        'items.productId': new Types.ObjectId(productId),
        'items.selectedSize': selectedSize ?? null,
      },
      { $inc: { 'items.$.quantity': quantity }, $set: { 'items.$.priceSnapshot': product.price } }
    );
  } else {
    try {
      await Cart.findOneAndUpdate(
        { storeId: new Types.ObjectId(storeId), customerId: new Types.ObjectId(customerId) },
        {
          $push: {
            items: {
              productId: new Types.ObjectId(productId),
              quantity,
              priceSnapshot: product.price,
              selectedSize: selectedSize ?? null,
            },
          },
        },
        { upsert: true }
      );
    } catch (err: any) {
      // Duplicate key: two concurrent requests both tried to create the cart.
      // The other request won — retry as a plain update (cart now exists).
      if (err.code === 11000) {
        await Cart.updateOne(
          { storeId: new Types.ObjectId(storeId), customerId: new Types.ObjectId(customerId) },
          {
            $push: {
              items: {
                productId: new Types.ObjectId(productId),
                quantity,
                priceSnapshot: product.price,
                selectedSize: selectedSize ?? null,
              },
            },
          }
        );
      } else {
        throw err;
      }
    }
  }

  return buildCartView(storeId, customerId);
}

export async function updateItemQuantity(
  storeId: string,
  customerId: string,
  productId: string,
  quantity: number,
  selectedSize?: string
): Promise<CartView> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  if (quantity === 0) {
    return removeItem(storeId, customerId, productId, selectedSize);
  }

  const product = await Product.findOne({
    _id: productId,
    storeId: new Types.ObjectId(storeId),
    isDeleted: false,
  }).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');

  if (quantity > product.stock) {
    throw createError(`Only ${product.stock} unit(s) available`, 400, 'BAD_REQUEST');
  }

  // Match on both productId AND selectedSize so different sizes are treated as
  // independent line items — fixes the positional $ operator ambiguity bug.
  const result = await Cart.updateOne(
    {
      storeId: new Types.ObjectId(storeId),
      customerId: new Types.ObjectId(customerId),
      'items.productId': new Types.ObjectId(productId),
      'items.selectedSize': selectedSize ?? null,
    },
    { $set: { 'items.$.quantity': quantity, 'items.$.priceSnapshot': product.price } }
  );

  if (result.matchedCount === 0) {
    throw createError('Item not found in cart', 404, 'NOT_FOUND');
  }

  return buildCartView(storeId, customerId);
}

export async function removeItem(storeId: string, customerId: string, productId: string, selectedSize?: string): Promise<CartView> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  // When selectedSize is provided, remove only that specific size variant.
  // When not provided (e.g. a size-less product), remove all entries for this productId.
  const pullFilter: Record<string, unknown> = { productId: new Types.ObjectId(productId) };
  if (selectedSize !== undefined) {
    pullFilter.selectedSize = selectedSize ?? null;
  }

  await Cart.updateOne(
    { storeId: new Types.ObjectId(storeId), customerId: new Types.ObjectId(customerId) },
    { $pull: { items: pullFilter } }
  );

  return buildCartView(storeId, customerId);
}

export async function clearCart(storeId: string, customerId: string): Promise<CartView> {
  await Cart.updateOne(
    { storeId: new Types.ObjectId(storeId), customerId: new Types.ObjectId(customerId) },
    { $set: { items: [] } }
  );
  return buildCartView(storeId, customerId);
}
