import { Types } from 'mongoose';
import { createError } from '../../middleware/errorHandler';
import * as productRepo from './product.repository';

export interface ProductDoc {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  name: string;
  description: string;
  price: number;
  discount: number;
  stock: number;
  categoryId: Types.ObjectId;
  images: string[];
  sizes: string[];
  isDeleted: boolean;
  inStock: boolean;
  averageRating: number;
  reviewCount: number;
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
  const storeObjId = new Types.ObjectId(filters.storeId);

  // ── Build sort option ──────────────────────────────────────────────────────
  let sortOption: Record<string, 1 | -1> = { createdAt: -1 };
  if (filters.sortBy === 'price_asc') sortOption = { price: 1 };
  else if (filters.sortBy === 'price_desc') sortOption = { price: -1 };
  else if (filters.sortBy === 'rating') sortOption = { averageRating: -1, reviewCount: -1 };
  else if (filters.sortBy === 'newest') sortOption = { createdAt: -1 };

  // ── Resolve category IDs (including children) ──────────────────────────────
  let categoryIds: Types.ObjectId[] | undefined;
  if (filters.category) {
    if (!Types.ObjectId.isValid(filters.category)) {
      throw createError('Invalid category ID', 400, 'BAD_REQUEST');
    }
    const parentId = new Types.ObjectId(filters.category);
    const childIds = await productRepo.findChildCategoryIds(parentId, storeObjId);
    categoryIds = [parentId, ...childIds];
  }

  // ── Resolve inStock flag ───────────────────────────────────────────────────
  let inStock: boolean | null | undefined;
  if (filters.inStock === 'true')  inStock = true;
  else if (filters.inStock === 'false') inStock = false;

  // ── Build search regex ─────────────────────────────────────────────────────
  // Substring match, case-insensitive. The pattern used to be ^-anchored, so a
  // search for "shirt" only matched products whose name or description BEGAN
  // with it — "Blue Shirt" was invisible. Metacharacters are still escaped so a
  // query like ".*" is treated literally rather than as a wildcard.
  //
  // NOTE: an unanchored case-insensitive regex cannot use a btree index, so this
  // is a collection scan per search. Correct, but it will not scale — a MongoDB
  // text index is the long-term answer and changes matching semantics
  // (whole-word, stemmed), so it is deliberately not swapped in here.
  let searchPattern: RegExp | undefined;
  if (filters.search) {
    searchPattern = new RegExp(filters.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }

  const skip = (filters.page - 1) * filters.limit;

  const { data, total } = await productRepo.findProductsPaginated({
    storeId: storeObjId,
    categoryIds,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    inStock,
    onSale: filters.onSale === 'true',
    searchPattern,
    sortOption,
    skip,
    limit: filters.limit,
  });

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
  const product = await productRepo.findProductById(id, new Types.ObjectId(storeId));
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
  const { resolveSubscriptionAccess } = await import('../stores/subscription-access');

  const store = await Store.findById(data.storeId).lean();
  if (!store) throw createError('Store not found', 404, 'NOT_FOUND');

  // Quotas follow the EFFECTIVE plan, never the declared one. `runDunningJob`
  // suspends a store without touching `subscriptionPlan`, so a merchant who
  // stopped paying still reads `subscriptionPlan: 'pro'` — reading that field
  // directly granted unlimited products indefinitely after the last payment
  // failed. The resolver maps a lapsed or suspended store back to free limits
  // without destroying the record of what they were subscribed to.
  const { effectivePlan } = resolveSubscriptionAccess(store);
  const limits = getPlanLimits(effectivePlan);

  if (limits.maxProducts !== -1) {
    const currentCount = await productRepo.countProductsByStore(new Types.ObjectId(data.storeId));
    if (currentCount >= limits.maxProducts) {
      throw createError(
        `Your ${effectivePlan} plan allows a maximum of ${limits.maxProducts} products. ` +
        `Upgrade your plan to add more products.`,
        403,
        'PLAN_LIMIT_EXCEEDED'
      );
    }
  }

  const product = await productRepo.createProduct(data as any);
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
  const product = await productRepo.findAndUpdateProduct(id, new Types.ObjectId(storeId), data as any);
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return product as unknown as ProductDoc;
}

export async function softDeleteProduct(id: string, storeId: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const result = await productRepo.softDeleteProductById(id, new Types.ObjectId(storeId));
  if (!result) throw createError('Product not found', 404, 'NOT_FOUND');
}

export async function removeProductImage(id: string, storeId: string, imageUrl: string): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const product = await productRepo.pullProductImage(id, new Types.ObjectId(storeId), imageUrl);
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return product as unknown as ProductDoc;
}

export async function bulkDeleteProducts(ids: string[], storeId: string): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  if (validIds.length === 0) throw createError('No valid product IDs provided', 400, 'BAD_REQUEST');
  const result = await productRepo.bulkSoftDelete(validIds, new Types.ObjectId(storeId));
  return result.modifiedCount;
}

export async function bulkUpdateProducts(
  ids: string[],
  storeId: string,
  data: Partial<{ price: number; stock: number; discount: number; categoryId: string }>
): Promise<number> {
  const validIds = ids.filter(id => Types.ObjectId.isValid(id)).map(id => new Types.ObjectId(id));
  if (validIds.length === 0) throw createError('No valid product IDs provided', 400, 'BAD_REQUEST');
  const result = await productRepo.bulkUpdate(validIds, new Types.ObjectId(storeId), data as any);
  return result.modifiedCount;
}

export async function addProductImage(id: string, storeId: string, imageUrl: string): Promise<ProductDoc> {
  if (!Types.ObjectId.isValid(id)) {
    throw createError('Invalid product ID', 400, 'BAD_REQUEST');
  }
  const product = await productRepo.pushProductImage(id, new Types.ObjectId(storeId), imageUrl);
  if (!product) throw createError('Product not found', 404, 'NOT_FOUND');
  return product as unknown as ProductDoc;
}
