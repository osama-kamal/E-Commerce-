import { Types } from 'mongoose';
import { createError } from '../../middleware/errorHandler';
import * as cartRepo from './cart.repository';
import * as productRepo from '../products/product.repository';

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
  const storeObjId  = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);

  const cart = await cartRepo.findCart(storeObjId, customerObjId);

  if (!cart || cart.items.length === 0) {
    return {
      storeId: storeObjId,
      customerId: customerObjId,
      items: [],
      subtotal: 0,
      updatedAt: cart?.updatedAt ?? new Date(),
    };
  }

  const productIds = cart.items.map((i) => i.productId);
  const products = await productRepo.findProductsByIds(productIds, storeObjId);

  const priceMap = new Map(products.map((p) => [p._id.toString(), p]));

  const items: CartItemView[] = [];
  let subtotal = 0;

  for (const item of cart.items) {
    const product = priceMap.get(item.productId.toString());
    if (!product) continue;

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

  const storeObjId    = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);
  const productObjId  = new Types.ObjectId(productId);

  const product = await productRepo.findProductById(productId, storeObjId);
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  if (product.stock <= 0) throw createError('Product is out of stock', 400, 'BAD_REQUEST');

  const cart = await cartRepo.findCart(storeObjId, customerObjId);

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
    await cartRepo.incrementItemQuantity(
      storeObjId, customerObjId, productObjId, selectedSize ?? null, quantity, product.price
    );
  } else {
    try {
      await cartRepo.upsertPushItem(storeObjId, customerObjId, {
        productId: productObjId,
        quantity,
        priceSnapshot: product.price,
        selectedSize: selectedSize ?? null,
      });
    } catch (err: any) {
      if (err.code === 11000) {
        await cartRepo.pushItemFallback(storeObjId, customerObjId, {
          productId: productObjId,
          quantity,
          priceSnapshot: product.price,
          selectedSize: selectedSize ?? null,
        });
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

  const storeObjId    = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);
  const productObjId  = new Types.ObjectId(productId);

  const product = await productRepo.findProductById(productId, storeObjId);
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');

  if (quantity > product.stock) {
    throw createError(`Only ${product.stock} unit(s) available`, 400, 'BAD_REQUEST');
  }

  const result = await cartRepo.setItemQuantity(
    storeObjId, customerObjId, productObjId, selectedSize ?? null, quantity, product.price
  );

  if (result.matchedCount === 0) {
    throw createError('Item not found in cart', 404, 'NOT_FOUND');
  }

  return buildCartView(storeId, customerId);
}

export async function removeItem(
  storeId: string,
  customerId: string,
  productId: string,
  selectedSize?: string
): Promise<CartView> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const pullFilter: Record<string, unknown> = { productId: new Types.ObjectId(productId) };
  if (selectedSize !== undefined) {
    pullFilter.selectedSize = selectedSize ?? null;
  }

  await cartRepo.pullItem(
    new Types.ObjectId(storeId),
    new Types.ObjectId(customerId),
    pullFilter
  );

  return buildCartView(storeId, customerId);
}

export async function clearCart(storeId: string, customerId: string): Promise<CartView> {
  await cartRepo.clearItems(new Types.ObjectId(storeId), new Types.ObjectId(customerId));
  return buildCartView(storeId, customerId);
}
