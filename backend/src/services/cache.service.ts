import NodeCache from 'node-cache';

// ── Cache Service ──────────────────────────────────────────────────────────────

class CacheService {
  private cache: NodeCache;

  constructor() {
    this.cache = new NodeCache({
      stdTTL: 600, // Default TTL: 10 minutes
      checkperiod: 120, // Check for expired keys every 2 minutes
      useClones: false, // Don't clone objects for better performance
    });
  }

  /**
   * Get a value from cache
   */
  get<T>(key: string): T | null {
    const value = this.cache.get<T>(key);
    return value !== undefined ? value : null;
  }

  /**
   * Set a value in cache with optional TTL
   */
  set<T>(key: string, value: T, ttlSeconds?: number): void {
    if (ttlSeconds) {
      this.cache.set(key, value, ttlSeconds);
    } else {
      this.cache.set(key, value);
    }
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidate(pattern: string): void {
    const keys = this.cache.keys();
    const regex = new RegExp(pattern);
    
    keys.forEach(key => {
      if (regex.test(key)) {
        this.cache.del(key);
      }
    });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.flushAll();
  }

  /**
   * Delete a specific key
   */
  delete(key: string): void {
    this.cache.del(key);
  }

  /**
   * Check if a key exists
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// ── Cache Key Patterns ─────────────────────────────────────────────────────────

export const CACHE_KEYS = {
  TODAY_METRICS: 'analytics:today-metrics',
  SALES_TRENDS: (start: string, end: string, granularity: string, categoryId?: string) =>
    `analytics:sales-trends:${start}:${end}:${granularity}${categoryId ? `:${categoryId}` : ''}`,
  CATEGORY_PERFORMANCE: (start: string, end: string) =>
    `analytics:category-performance:${start}:${end}`,
  CUSTOMER_METRICS: (start: string, end: string) =>
    `analytics:customer-metrics:${start}:${end}`,
  AOV_METRICS: (start: string, end: string) =>
    `analytics:aov-metrics:${start}:${end}`,
  CONVERSION_METRICS: (start: string, end: string) =>
    `analytics:conversion-metrics:${start}:${end}`,
  RECENT_ORDERS: (limit: number) =>
    `analytics:recent-orders:${limit}`,
  REVENUE_GOAL: (period: string) =>
    `analytics:revenue-goal:${period}`,
};

// ── Cache TTL Values (in seconds) ──────────────────────────────────────────────

export const CACHE_TTL = {
  TODAY_METRICS: 300, // 5 minutes
  SALES_TRENDS: 1800, // 30 minutes
  CATEGORY_PERFORMANCE: 1800, // 30 minutes
  CUSTOMER_METRICS: 3600, // 1 hour
  AOV_METRICS: 1800, // 30 minutes
  CONVERSION_METRICS: 1800, // 30 minutes
  RECENT_ORDERS: 60, // 1 minute
  REVENUE_GOAL: 300, // 5 minutes
};
