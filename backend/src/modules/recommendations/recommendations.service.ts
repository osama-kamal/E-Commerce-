import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';

export const recommendationsService = {
  /**
   * Get AI-powered product recommendations for a specific product
   * Combines multiple recommendation strategies
   */
  async getRecommendations(productId: string, limit = 6) {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    // Strategy 1: Content-Based - Same category products
    const categoryRecommendations = await this.getCategoryBasedRecommendations(
      product.categoryId.toString(),
      productId,
      limit
    );

    // Strategy 2: Collaborative Filtering - Frequently bought together (same category only)
    const collaborativeRecommendations = await this.getCollaborativeRecommendations(
      productId,
      product.categoryId.toString(),
      limit
    );

    // Strategy 3: Popularity-Based - Best sellers in same category
    const popularRecommendations = await this.getPopularRecommendations(
      product.categoryId.toString(),
      productId,
      limit
    );

    // Combine and deduplicate recommendations
    const combined = this.combineRecommendations(
      categoryRecommendations,
      collaborativeRecommendations,
      popularRecommendations,
      limit
    );

    return combined;
  },

  /**
   * Content-Based: Products from the same category
   */
  async getCategoryBasedRecommendations(
    categoryId: string,
    excludeProductId: string,
    limit: number
  ) {
    return await Product.find({
      categoryId: categoryId,
      _id: { $ne: excludeProductId },
      stock: { $gt: 0 },
      isDeleted: false,
    })
      .sort({ averageRating: -1, reviewCount: -1 })
      .limit(limit)
      .lean();
  },

  /**
   * Collaborative Filtering: Products frequently bought together
   * Analyzes order history to find products that appear together
   * IMPORTANT: Only returns products from the same category
   */
  async getCollaborativeRecommendations(productId: string, categoryId: string, limit: number) {
    // Find orders that contain this product
    const ordersWithProduct = await Order.find({
      'items.productId': productId,
    }).select('items').lean();

    if (ordersWithProduct.length === 0) {
      return [];
    }

    // Count frequency of other products in these orders
    const productFrequency: Record<string, number> = {};

    ordersWithProduct.forEach(order => {
      order.items.forEach(item => {
        const itemProductId = item.productId.toString();
        if (itemProductId !== productId) {
          productFrequency[itemProductId] = (productFrequency[itemProductId] || 0) + 1;
        }
      });
    });

    // Sort by frequency and get top products
    const sortedProducts = Object.entries(productFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit * 2) // Get more to filter by category
      .map(([id]) => id);

    if (sortedProducts.length === 0) {
      return [];
    }

    // Fetch product details - FILTER BY SAME CATEGORY
    return await Product.find({
      _id: { $in: sortedProducts },
      categoryId: categoryId, // Only same category
      stock: { $gt: 0 },
      isDeleted: false,
    })
      .limit(limit)
      .lean();
  },

  /**
   * Popularity-Based: Best sellers and highly rated products
   */
  async getPopularRecommendations(
    categoryId: string,
    excludeProductId: string,
    limit: number
  ) {
    // Try to get highly rated products first
    let products = await Product.find({
      categoryId: categoryId,
      _id: { $ne: excludeProductId },
      stock: { $gt: 0 },
      isDeleted: false,
      averageRating: { $gte: 4 },
    })
      .sort({ reviewCount: -1, averageRating: -1 })
      .limit(limit)
      .lean();

    // If not enough highly rated products, fill with any products from same category
    if (products.length < limit) {
      const additionalProducts = await Product.find({
        categoryId: categoryId,
        _id: { $ne: excludeProductId, $nin: products.map(p => p._id) },
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
   * Combine recommendations from different strategies
   * Prioritizes collaborative filtering, then content-based, then popularity
   */
  combineRecommendations(
    category: any[],
    collaborative: any[],
    popular: any[],
    limit: number
  ) {
    const seen = new Set<string>();
    const combined: any[] = [];

    // Helper to add unique products
    const addUnique = (products: any[]) => {
      for (const product of products) {
        const id = product._id.toString();
        if (!seen.has(id) && combined.length < limit) {
          seen.add(id);
          combined.push(product);
        }
      }
    };

    // Priority order: collaborative > category > popular
    addUnique(collaborative);
    addUnique(category);
    addUnique(popular);

    return combined;
  },

  /**
   * Get personalized recommendations for a user based on their behavior
   */
  async getPersonalizedRecommendations(userId: string, limit = 8) {
    // Get user's order history
    const userOrders = await Order.find({ customerId: userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('items')
      .lean();

    if (userOrders.length === 0) {
      // New user - return trending products
      return await this.getTrendingProducts(limit);
    }

    // Extract categories from user's purchase history
    const purchasedProductIds = userOrders.flatMap(order =>
      order.items.map(item => item.productId)
    );

    const purchasedProducts = await Product.find({
      _id: { $in: purchasedProductIds },
    })
      .select('categoryId')
      .lean();

    const categoryIds = [...new Set(purchasedProducts.map(p => p.categoryId.toString()))];

    // Get recommendations from user's preferred categories
    const recommendations = await Product.find({
      categoryId: { $in: categoryIds },
      _id: { $nin: purchasedProductIds },
      stock: { $gt: 0 },
      isDeleted: false,
    })
      .sort({ averageRating: -1, reviewCount: -1 })
      .limit(limit)
      .lean();

    // If not enough recommendations, fill with trending products
    if (recommendations.length < limit) {
      const trending = await this.getTrendingProducts(limit - recommendations.length);
      const trendingFiltered = trending.filter(
        t => !recommendations.some(r => r._id.toString() === t._id.toString())
      );
      recommendations.push(...trendingFiltered);
    }

    return recommendations;
  },

  /**
   * Get trending products (best sellers + highly rated)
   */
  async getTrendingProducts(limit: number) {
    // Try to get highly rated products first
    let products = await Product.find({
      stock: { $gt: 0 },
      isDeleted: false,
      averageRating: { $gte: 4 },
    })
      .sort({ reviewCount: -1, averageRating: -1 })
      .limit(limit)
      .lean();

    // If not enough highly rated products, fill with any available products
    if (products.length < limit) {
      const additionalProducts = await Product.find({
        stock: { $gt: 0 },
        isDeleted: false,
        _id: { $nin: products.map(p => p._id) },
      })
        .sort({ createdAt: -1 }) // Newest first
        .limit(limit - products.length)
        .lean();

      products = [...products, ...additionalProducts];
    }

    return products;
  },
};
