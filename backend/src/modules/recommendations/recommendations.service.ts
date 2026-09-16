import { Types } from 'mongoose';
import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';
import { createError } from '../../middleware/errorHandler';

/**
 * Product recommendations.
 *
 * ── What this fixes ───────────────────────────────────────────────────────────
 * Not one query in this module filtered on `storeId`. The routes are mounted on
 * the tenant router, so `req.store` was resolved on every request — the service
 * simply never asked for it. The result was a live cross-tenant leak:
 *
 *   • `GET /recommendations/trending` is PUBLIC and unauthenticated, and
 *     returned the highest-rated products on the ENTIRE PLATFORM. Every
 *     merchant's storefront was advertising its competitors' catalogue —
 *     names, prices, ratings and images.
 *   • `GET /recommendations/personalized` scanned a customer's orders with no
 *     store filter, then recommended products with no store filter. One address
 *     legitimately holds separate accounts in separate stores (the unique index
 *     is `{storeId, email}`), so a shopper's purchases in one shop steered the
 *     recommendations they saw in another.
 *
 * Product-page recommendations were tenant-safe only BY ACCIDENT: they filter on
 * `categoryId`, and categories carry a `storeId`, so the scope came in through
 * the back door. That is precisely why this survived review — the one path
 * anybody would think to check looked correct.
 *
 * ── Why storeId is a required first parameter ─────────────────────────────────
 * Every exported method now takes `storeId` as its first argument, and it is not
 * optional. An optional tenant key is one a caller can forget, and forgetting it
 * is what produced this bug. Making it required moves the guarantee to the
 * compiler: a new caller cannot omit it, and a new method that fails to thread
 * it through will not typecheck against these helpers.
 *
 * `tenant-isolation` in the integration tests pins the behaviour; the signature
 * pins the intent.
 */

/** Narrowed once at the boundary so every helper below takes a real ObjectId. */
function toStoreObjectId(storeId: string): Types.ObjectId {
  if (!storeId || !Types.ObjectId.isValid(storeId)) {
    // Refusing beats guessing. A missing tenant key here previously meant
    // "search every store", which is the failure this module is being fixed for.
    throw createError('Store context is required', 400, 'BAD_REQUEST');
  }
  return new Types.ObjectId(storeId);
}

export const recommendationsService = {
  /**
   * Recommendations for a specific product, blending three strategies.
   *
   * The product itself is looked up WITHIN the store, so a product id belonging
   * to another tenant reads as "not found" rather than seeding recommendations
   * from a catalogue the caller cannot see.
   */
  async getRecommendations(storeId: string, productId: string, limit = 6) {
    const storeObjId = toStoreObjectId(storeId);

    if (!Types.ObjectId.isValid(productId)) {
      throw createError('Product not found', 404, 'NOT_FOUND');
    }

    const product = await Product.findOne({
      _id: new Types.ObjectId(productId),
      storeId: storeObjId,
      isDeleted: false,
    }).lean();

    if (!product) {
      throw createError('Product not found', 404, 'NOT_FOUND');
    }

    const categoryId = product.categoryId.toString();

    // Strategy 1: Content-Based — same category products
    const categoryRecommendations = await this.getCategoryBasedRecommendations(
      storeObjId,
      categoryId,
      productId,
      limit
    );

    // Strategy 2: Collaborative Filtering — frequently bought together
    const collaborativeRecommendations = await this.getCollaborativeRecommendations(
      storeObjId,
      productId,
      categoryId,
      limit
    );

    // Strategy 3: Popularity-Based — best sellers in same category
    const popularRecommendations = await this.getPopularRecommendations(
      storeObjId,
      categoryId,
      productId,
      limit
    );

    return this.combineRecommendations(
      categoryRecommendations,
      collaborativeRecommendations,
      popularRecommendations,
      limit
    );
  },

  /**
   * Content-Based: products from the same category.
   *
   * `categoryId` alone happens to imply a tenant, because categories carry a
   * storeId. The explicit filter stays anyway — relying on that coupling is how
   * the rest of this module ended up unscoped, and a category made global later
   * would silently reopen the leak.
   */
  async getCategoryBasedRecommendations(
    storeObjId: Types.ObjectId,
    categoryId: string,
    excludeProductId: string,
    limit: number
  ) {
    return Product.find({
      storeId: storeObjId,
      categoryId,
      _id: { $ne: excludeProductId },
      stock: { $gt: 0 },
      isDeleted: false,
    })
      .sort({ averageRating: -1, reviewCount: -1 })
      .limit(limit)
      .lean();
  },

  /**
   * Collaborative Filtering: products frequently bought together.
   *
   * The order scan is the part that mattered most. It previously read
   * `Order.find({ 'items.productId': productId })` across EVERY tenant's orders
   * — a full-collection scan over other merchants' purchase histories to build
   * the co-purchase table. Scoping it to the store keeps the computation inside
   * one tenant and lets the `{storeId, ...}` index serve the query.
   *
   * Bounded with `.limit()` as well: this loads orders into memory, and an
   * unbounded scan on a store with millions of orders is its own outage.
   */
  async getCollaborativeRecommendations(
    storeObjId: Types.ObjectId,
    productId: string,
    categoryId: string,
    limit: number
  ) {
    const ordersWithProduct = await Order.find({
      storeId: storeObjId,
      'items.productId': productId,
    })
      .select('items')
      .limit(500)
      .lean();

    if (ordersWithProduct.length === 0) return [];

    const productFrequency: Record<string, number> = {};

    ordersWithProduct.forEach((order) => {
      order.items.forEach((item) => {
        const itemProductId = item.productId.toString();
        if (itemProductId !== productId) {
          productFrequency[itemProductId] = (productFrequency[itemProductId] || 0) + 1;
        }
      });
    });

    const sortedProducts = Object.entries(productFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit * 2) // over-fetch, then filter by category
      .map(([id]) => id);

    if (sortedProducts.length === 0) return [];

    return Product.find({
      storeId: storeObjId,
      _id: { $in: sortedProducts },
      categoryId,
      stock: { $gt: 0 },
      isDeleted: false,
    })
      .limit(limit)
      .lean();
  },

  /** Popularity-Based: best sellers and highly rated products in this store. */
  async getPopularRecommendations(
    storeObjId: Types.ObjectId,
    categoryId: string,
    excludeProductId: string,
    limit: number
  ) {
    let products = await Product.find({
      storeId: storeObjId,
      categoryId,
      _id: { $ne: excludeProductId },
      stock: { $gt: 0 },
      isDeleted: false,
      averageRating: { $gte: 4 },
    })
      .sort({ reviewCount: -1, averageRating: -1 })
      .limit(limit)
      .lean();

    if (products.length < limit) {
      const additionalProducts = await Product.find({
        storeId: storeObjId,
        categoryId,
        _id: { $ne: excludeProductId, $nin: products.map((p) => p._id) },
        stock: { $gt: 0 },
        isDeleted: false,
      })
        .sort({ createdAt: -1 })
        .limit(limit - products.length)
        .lean();

      products = [...products, ...additionalProducts];
    }

    return products;
  },

  /**
   * Combine recommendations from different strategies.
   * Priority: collaborative > content > popularity.
   */
  combineRecommendations(
    category: Array<{ _id: Types.ObjectId }>,
    collaborative: Array<{ _id: Types.ObjectId }>,
    popular: Array<{ _id: Types.ObjectId }>,
    limit: number
  ) {
    const seen = new Set<string>();
    const combined: Array<{ _id: Types.ObjectId }> = [];

    const addUnique = (products: Array<{ _id: Types.ObjectId }>) => {
      for (const product of products) {
        const id = product._id.toString();
        if (!seen.has(id) && combined.length < limit) {
          seen.add(id);
          combined.push(product);
        }
      }
    };

    addUnique(collaborative);
    addUnique(category);
    addUnique(popular);

    return combined;
  },

  /**
   * Personalised recommendations from a customer's behaviour IN THIS STORE.
   *
   * Both halves were unscoped. The order history was read by `customerId`
   * alone, and one email address legitimately holds separate accounts in
   * separate stores, so a shopper's purchases in one shop shaped what another
   * shop recommended to them. The catalogue query was unscoped too, so even a
   * correctly-derived category list returned other tenants' products.
   */
  async getPersonalizedRecommendations(storeId: string, userId: string, limit = 8) {
    const storeObjId = toStoreObjectId(storeId);

    if (!Types.ObjectId.isValid(userId)) {
      throw createError('Invalid user ID', 400, 'BAD_REQUEST');
    }
    const customerObjId = new Types.ObjectId(userId);

    const userOrders = await Order.find({
      storeId: storeObjId,
      customerId: customerObjId,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('items')
      .lean();

    // No history in THIS store — a shopper new to this shop, even one with a
    // long history elsewhere on the platform.
    if (userOrders.length === 0) {
      return this.getTrendingProducts(storeId, limit);
    }

    const purchasedProductIds = userOrders.flatMap((order) =>
      order.items.map((item) => item.productId)
    );

    const purchasedProducts = await Product.find({
      storeId: storeObjId,
      _id: { $in: purchasedProductIds },
    })
      .select('categoryId')
      .lean();

    const categoryIds = [...new Set(purchasedProducts.map((p) => p.categoryId.toString()))];

    const recommendations = await Product.find({
      storeId: storeObjId,
      categoryId: { $in: categoryIds },
      _id: { $nin: purchasedProductIds },
      stock: { $gt: 0 },
      isDeleted: false,
    })
      .sort({ averageRating: -1, reviewCount: -1 })
      .limit(limit)
      .lean();

    if (recommendations.length < limit) {
      const trending = await this.getTrendingProducts(storeId, limit - recommendations.length);
      const trendingFiltered = trending.filter(
        (t) => !recommendations.some((r) => r._id.toString() === t._id.toString())
      );
      recommendations.push(...trendingFiltered);
    }

    return recommendations;
  },

  /**
   * Trending products WITHIN one store.
   *
   * This was the worst of the three: a public, unauthenticated endpoint with no
   * category filter and no store filter, returning the highest-rated products
   * across the whole platform. A merchant's own storefront rendered a "trending"
   * widget populated with rivals' products, and the better a competitor's
   * catalogue rated, the more prominently it appeared.
   */
  async getTrendingProducts(storeId: string, limit: number) {
    const storeObjId = toStoreObjectId(storeId);

    let products = await Product.find({
      storeId: storeObjId,
      stock: { $gt: 0 },
      isDeleted: false,
      averageRating: { $gte: 4 },
    })
      .sort({ reviewCount: -1, averageRating: -1 })
      .limit(limit)
      .lean();

    if (products.length < limit) {
      const additionalProducts = await Product.find({
        storeId: storeObjId,
        stock: { $gt: 0 },
        isDeleted: false,
        _id: { $nin: products.map((p) => p._id) },
      })
        .sort({ createdAt: -1 })
        .limit(limit - products.length)
        .lean();

      products = [...products, ...additionalProducts];
    }

    return products;
  },
};
