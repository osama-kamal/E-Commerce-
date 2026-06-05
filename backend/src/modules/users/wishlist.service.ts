import { Types } from 'mongoose';
import { Wishlist } from './wishlist.model';
import { Product } from '../products/product.model';
import { Cart } from '../cart/cart.model';
import { createError } from '../../middleware/errorHandler';

export interface WishlistDoc {
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  products: {
    _id: Types.ObjectId;
    name: string;
    price: number;
    images: string[];
    stock: number;
    averageRating: number;
  }[];
  updatedAt: Date;
}

export async function getWishlist(storeId: string, customerId: string): Promise<WishlistDoc> {
  const wishlist = await Wishlist.findOne({
    storeId: new Types.ObjectId(storeId),
    customerId: new Types.ObjectId(customerId),
  })
    .populate('productIds', 'name price images stock averageRating isDeleted')
    .lean();

  if (!wishlist) {
    return {
      storeId: new Types.ObjectId(storeId),
      customerId: new Types.ObjectId(customerId),
      products: [],
      updatedAt: new Date(),
    };
  }

  const products = (wishlist.productIds as unknown as Array<{
    _id: Types.ObjectId;
    name: string;
    price: number;
    images: string[];
    stock: number;
    averageRating: number;
    isDeleted: boolean;
  }>).filter((p) => !p.isDeleted);

  return {
    storeId: wishlist.storeId,
    customerId: wishlist.customerId,
    products,
    updatedAt: wishlist.updatedAt,
  };
}

export async function addToWishlist(storeId: string, customerId: string, productId: string): Promise<WishlistDoc> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const product = await Product.findOne({
    _id: productId,
    storeId: new Types.ObjectId(storeId),
    isDeleted: false,
  }).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');

  await Wishlist.findOneAndUpdate(
    { storeId: new Types.ObjectId(storeId), customerId: new Types.ObjectId(customerId) },
    { $addToSet: { productIds: new Types.ObjectId(productId) } },
    { upsert: true }
  );

  return getWishlist(storeId, customerId);
}

export async function removeFromWishlist(storeId: string, customerId: string, productId: string): Promise<WishlistDoc> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  await Wishlist.updateOne(
    { storeId: new Types.ObjectId(storeId), customerId: new Types.ObjectId(customerId) },
    { $pull: { productIds: new Types.ObjectId(productId) } }
  );

  return getWishlist(storeId, customerId);
}

export async function moveToCart(storeId: string, customerId: string, productId: string): Promise<WishlistDoc> {
  if (!Types.ObjectId.isValid(productId)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }

  const storeObjId = new Types.ObjectId(storeId);
  const customerObjId = new Types.ObjectId(customerId);
  const productObjId = new Types.ObjectId(productId);

  const product = await Product.findOne({ _id: productObjId, storeId: storeObjId, isDeleted: false }).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  if (product.stock <= 0) throw createError('Product is out of stock', 400, 'BAD_REQUEST');

  const cart = await Cart.findOne({ storeId: storeObjId, customerId: customerObjId }).lean();
  const existingItem = cart?.items.find((i) => i.productId.toString() === productId);
  const currentQty = existingItem?.quantity ?? 0;

  if (currentQty + 1 > product.stock) {
    throw createError(
      `Only ${product.stock} unit(s) available (you already have ${currentQty} in cart)`,
      400,
      'BAD_REQUEST'
    );
  }

  if (existingItem) {
    await Cart.updateOne(
      { storeId: storeObjId, customerId: customerObjId, 'items.productId': productObjId },
      { $inc: { 'items.$.quantity': 1 }, $set: { 'items.$.priceSnapshot': product.price } }
    );
  } else {
    await Cart.findOneAndUpdate(
      { storeId: storeObjId, customerId: customerObjId },
      {
        $push: {
          items: { productId: productObjId, quantity: 1, priceSnapshot: product.price },
        },
      },
      { upsert: true }
    );
  }

  await Wishlist.updateOne(
    { storeId: storeObjId, customerId: customerObjId },
    { $pull: { productIds: productObjId } }
  );

  return getWishlist(storeId, customerId);
}
