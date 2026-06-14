/**
 * ProductRepository
 *
 * Owns all direct Mongoose queries for the Product collection.
 * Services import from here — not from the model directly.
 * No business logic lives here; only data access.
 */

import mongoose, { ClientSession, FilterQuery, Types } from 'mongoose';
import { Product, IProduct } from './product.model';
import { Category } from '../categories/category.model';

// ── Query helpers ─────────────────────────────────────────────────────────────

export type RawProduct = Omit<IProduct, keyof mongoose.Document>;

export interface ListProductsQuery {
  storeId: Types.ObjectId;
  categoryIds?: Types.ObjectId[];
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean | null;
  onSale?: boolean;
  searchPattern?: RegExp;
  sortOption: Record<string, 1 | -1>;
  skip: number;
  limit: number;
}

export async function findProductsPaginated(q: ListProductsQuery) {
  const filter: FilterQuery<IProduct> = {
    storeId: q.storeId,
    isDeleted: false,
  };

  if (q.categoryIds) filter.categoryId = { $in: q.categoryIds };
  if (q.minPrice !== undefined || q.maxPrice !== undefined) {
    filter.price = {};
    if (q.minPrice !== undefined) filter.price.$gte = q.minPrice;
    if (q.maxPrice !== undefined) filter.price.$lte = q.maxPrice;
  }
  if (q.inStock === true)  filter.stock = { $gt: 0 };
  if (q.inStock === false) filter.stock = 0;
  if (q.onSale) filter.discount = { $gt: 0 };
  if (q.searchPattern) filter.$or = [
    { name: { $regex: q.searchPattern } },
    { description: { $regex: q.searchPattern } },
  ];

  const [data, total] = await Promise.all([
    Product.find(filter)
      .sort(q.sortOption)
      .skip(q.skip)
      .limit(q.limit)
      .select('_id storeId name description price discount stock categoryId images sizes averageRating reviewCount isDeleted createdAt updatedAt')
      .lean(),
    Product.countDocuments(filter),
  ]);

  return { data, total };
}

export async function findProductById(id: string, storeId: Types.ObjectId) {
  return Product.findOne({ _id: id, storeId, isDeleted: false }).lean();
}

export async function countProductsByStore(storeId: Types.ObjectId) {
  return Product.countDocuments({ storeId, isDeleted: false });
}

export async function createProduct(data: Partial<IProduct>) {
  return Product.create(data);
}

export async function findAndUpdateProduct(
  id: string,
  storeId: Types.ObjectId,
  data: Partial<IProduct>
) {
  return Product.findOneAndUpdate(
    { _id: id, storeId, isDeleted: false },
    data,
    { new: true }
  ).lean();
}

export async function softDeleteProductById(id: string, storeId: Types.ObjectId) {
  return Product.findOneAndUpdate(
    { _id: id, storeId, isDeleted: false },
    { isDeleted: true }
  );
}

export async function pullProductImage(id: string, storeId: Types.ObjectId, imageUrl: string) {
  return Product.findOneAndUpdate(
    { _id: id, storeId, isDeleted: false },
    { $pull: { images: imageUrl } },
    { new: true }
  ).lean();
}

export async function pushProductImage(id: string, storeId: Types.ObjectId, imageUrl: string) {
  return Product.findOneAndUpdate(
    { _id: id, storeId, isDeleted: false },
    { $push: { images: imageUrl } },
    { new: true }
  ).lean();
}

export async function bulkSoftDelete(ids: Types.ObjectId[], storeId: Types.ObjectId) {
  return Product.updateMany(
    { _id: { $in: ids }, storeId, isDeleted: false },
    { isDeleted: true }
  );
}

export async function bulkUpdate(
  ids: Types.ObjectId[],
  storeId: Types.ObjectId,
  data: Partial<IProduct>
) {
  return Product.updateMany(
    { _id: { $in: ids }, storeId, isDeleted: false },
    data
  );
}

export async function decrementStock(
  productId: Types.ObjectId,
  storeId: Types.ObjectId,
  qty: number,
  session?: ClientSession
) {
  return Product.updateOne(
    { _id: productId, storeId },
    { $inc: { stock: -qty } },
    ...(session ? [{ session }] : [])
  );
}

export async function findProductsByIds(
  ids: Types.ObjectId[],
  storeId: Types.ObjectId,
  session?: ClientSession
) {
  const q = Product.find({ _id: { $in: ids }, storeId, isDeleted: false });
  if (session) q.session(session);
  return q.lean();
}

// ── Category helper (used by listProducts service logic) ─────────────────────

export async function findChildCategoryIds(
  parentId: Types.ObjectId,
  storeId: Types.ObjectId
): Promise<Types.ObjectId[]> {
  const children = await Category.find({ parentId, storeId }).select('_id').lean();
  return children.map(c => c._id as Types.ObjectId);
}
