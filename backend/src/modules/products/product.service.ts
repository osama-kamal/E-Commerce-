import { Types } from 'mongoose';
import { Product } from './product.model';
import { Category } from '../categories/category.model';
import { createError } from '../../middleware/errorHandler';

export interface ProductDoc {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  name: string;
  description: string;
  price: number;
  stock: number;
  categoryId: Types.ObjectId;
  images: string[];
  isDeleted: boolean;
  inStock: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductFilters {
  storeId: string;
  page: number;
  limit: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: string;
  search?: string;
  onSale?: string;
  sortBy?: string;
}

export interface PaginatedProducts {
  data: ProductDoc[];
  total: number;
  page: number;
  totalPages: number;
}

export async function listProducts(filters: ProductFilters): Promise<PaginatedProducts> {
  const query: Record<string, unknown> = {
    storeId: new Types.ObjectId(filters.storeId),
    isDeleted: false,
  };

  if (filters.category) {
    if (!Types.ObjectId.isValid(filters.category)) {
      throw createError('Invalid category ID', 400, 'BAD_REQUEST');
    }
    const categoryObjId = new Types.ObjectId(filters.category);
    const children = await Category.find({ parentId: categoryObjId, storeId: new Types.ObjectId(filters.storeId) }).select('_id').lean();
    const categoryIds = [categoryObjId, ...children.map(c => c._id)];
    query.categoryId = { $in: categoryIds };
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    const priceFilter: Record<string, number> = {};
    if (filters.minPrice !== undefined) priceFilter.$gte = filters.minPrice;
    if (filters.maxPrice !== undefined) priceFilter.$lte = filters.maxPrice;
    query.price = priceFilter;
  }

  if (filters.inStock === 'true') {
    query.stock = { $gt: 0 };
  } else if (filters.inStock === 'false') {
    query.stock = 0;
  }

  if (filters.onSale === 'true') {
    query.discount = { $gt: 0 };
  }

  if (filters.search) {
    const pattern = new RegExp('^' + filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { name: { $regex: pattern } },
      { description: { $regex: pattern } },
    ];
  }

  let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
  if (filters.sortBy === 'price_asc') sortOption = { price: 1 };
  else if (filters.sortBy === 'price_desc') sortOption = { price: -1 };
  else if (filters.sortBy === 'rating') sortOption = { averageRating: -1, reviewCount: -1 };
  else if (filters.sortBy === 'newest') sortOption = { createdAt: -1 };

  const skip = (filters.page - 1) * filters.limit;
  const [data, total] = await Promise.all([
    Product.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(filters.limit)
      .select('_id storeId name description price discount stock categoryId images averageRating reviewCount isDeleted createdAt updatedAt')
      .lean(),
    Product.countDocuments(query),
  ]);

  return {
    data: data.map((p) => ({ ...p, inStock: p.stock > 0 })) as unknown as ProductDoc[],
    total,
    page: filters.page,
    totalPages: Math.ceil(total / filters.limit),
  };
}

export async function getProductById(id: string, storeId: string): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const product = await Product.findOne({
    _id: id,
    storeId: new Types.ObjectId(storeId),
    isDeleted: false,
  }).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return { ...product, inStock: product.stock > 0 } as unknown as ProductDoc;
}

export async function createProduct(data: {
  storeId: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  categoryId: string;
}): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(data.categoryId)) {
    throw createError('Invalid category ID', 400, 'BAD_REQUEST');
  }

  // ── Plan limit check ──────────────────────────────────────────────────────
  const { Store } = await import('../stores/store.model');
  const { getPlanLimits } = await import('../../config/planLimits');

  const store = await Store.findById(data.storeId).lean();
  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');

  const limits = getPlanLimits(store.subscriptionPlan);

  if (limits.maxProducts !== -1) {
    const currentCount = await Product.countDocuments({
      storeId: new Types.ObjectId(data.storeId),
      isDeleted: false,
    });

    if (currentCount >= limits.maxProducts) {
      throw createError(
        `Your ${store.subscriptionPlan} plan allows a maximum of ${limits.maxProducts} products. ` +
        `Upgrade your plan to add more products.`,
        403,
        'PLAN_LIMIT_EXCEEDED'
      );
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const product = await Product.create(data);
  return product.toObject() as unknown as ProductDoc;
}

export async function updateProduct(
  id: string,
  storeId: string,
  data: Partial<{ name: string; description: string; price: number; stock: number; categoryId: string }>
): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  if (data.categoryId && !Types.ObjectId.isValid(data.categoryId)) {
    throw createError('Invalid category ID', 400, 'BAD_REQUEST');
  }
  const product = await Product.findOneAndUpdate(
    { _id: id, storeId: new Types.ObjectId(storeId), isDeleted: false },
    data,
    { new: true }
  ).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return product as unknown as ProductDoc;
}

export async function softDeleteProduct(id: string, storeId: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const result = await Product.findOneAndUpdate(
    { _id: id, storeId: new Types.ObjectId(storeId), isDeleted: false },
    { isDeleted: true }
  );
  if (!result) throw createError('Product not found', 404, 'NOT_FOUND');
}

export async function removeProductImage(id: string, storeId: string, imageUrl: string): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const product = await Product.findOneAndUpdate(
    { _id: id, storeId: new Types.ObjectId(storeId), isDeleted: false },
    { $pull: { images: imageUrl } },
    { new: true }
  ).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return product as unknown as ProductDoc;
}

export async function bulkDeleteProducts(ids: string[], storeId: string): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id));
  if (validIds.length === 0) throw createError('No valid product IDs provided', 400, 'BAD_REQUEST');
  const result = await Product.updateMany(
    { _id: { $in: validIds }, storeId: new Types.ObjectId(storeId), isDeleted: false },
    { isDeleted: true }
  );
  return result.modifiedCount;
}

export async function bulkUpdateProducts(
  ids: string[],
  storeId: string,
  data: Partial<{ price: number; stock: number; discount: number; categoryId: string }>
): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id));
  if (validIds.length === 0) throw createError('No valid product IDs provided', 400, 'BAD_REQUEST');
  const result = await Product.updateMany(
    { _id: { $in: validIds }, storeId: new Types.ObjectId(storeId), isDeleted: false },
    data
  );
  return result.modifiedCount;
}

export async function addProductImage(id: string, storeId: string, imageUrl: string): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const product = await Product.findOneAndUpdate(
    { _id: id, storeId: new Types.ObjectId(storeId), isDeleted: false },
    { $push: { images: imageUrl } },
    { new: true }
  ).lean();
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return product as unknown as ProductDoc;
}
