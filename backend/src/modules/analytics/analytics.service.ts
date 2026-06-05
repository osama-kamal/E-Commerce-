import { Types } from 'mongoose';
import { Order } from '../orders/order.model';
import { Product } from '../products/product.model';
import { Category } from '../categories/category.model';
import { cacheService, CACHE_KEYS, CACHE_TTL } from '../../services/cache.service';
import {
  getPreviousPeriodRange,
  calculatePercentageChange,
  formatDateForCacheKey,
} from '../../utils/dateRange';

// ── Type Definitions ───────────────────────────────────────────────────────────

export interface DateRangeParams {
  storeId: string;
  startDate: Date;
  endDate: Date;
}

export interface SalesTrendsParams extends DateRangeParams {
  granularity: 'daily' | 'weekly' | 'monthly';
  categoryId?: string;
}

export interface SalesTrendsResult {
  trends: Array<{ date: string; revenue: number; orderCount: number }>;
  previousPeriod: { revenue: number; orderCount: number; percentageChange: number };
}

export interface CategoryPerformanceResult {
  categories: Array<{
    categoryId: string;
    categoryName: string;
    revenue: number;
    percentage: number;
    orderCount: number;
  }>;
  totalRevenue: number;
}

export interface CustomerMetricsResult {
  newCustomers: number;
  repeatCustomerRate: number;
  churnRate: number;
  acquisitionTrend: Array<{ date: string; newCustomers: number }>;
  previousPeriod: { newCustomers: number; percentageChange: number };
}

export interface AOVMetricsResult {
  currentAOV: number;
  previousAOV: number;
  percentageChange: number;
  trend: Array<{ date: string; aov: number }>;
}

export interface ConversionMetricsResult {
  conversionRate: number;
  previousConversionRate: number;
  percentageChange: number;
  trend: Array<{ date: string; conversionRate: number }>;
}

export interface TodayMetricsResult {
  today: { revenue: number; orderCount: number; activeUsers: number };
  yesterday: { revenue: number; orderCount: number };
  changes: { revenueChange: number; orderCountChange: number };
}

export interface RecentOrdersResult {
  orders: Array<{
    orderId: string;
    customerName: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    relativeTime: string;
  }>;
}

export interface RevenueGoalResult {
  currentRevenue: number;
  goalAmount: number;
  percentage: number;
  isExceeded: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ── Service Methods ────────────────────────────────────────────────────────────

export async function getSalesTrends(params: SalesTrendsParams): Promise<SalesTrendsResult> {
  const { storeId, startDate, endDate, granularity, categoryId } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const cacheKey = CACHE_KEYS.SALES_TRENDS(
    formatDateForCacheKey(startDate),
    formatDateForCacheKey(endDate),
    granularity,
    categoryId
  ) + `:${storeId}`;

  const cached = cacheService.get<SalesTrendsResult>(cacheKey);
  if (cached) return cached;

  let groupByExpression: any;
  switch (granularity) {
    case 'daily':
      groupByExpression = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
      break;
    case 'weekly':
      groupByExpression = {
        $dateToString: {
          format: '%Y-%m-%d',
          date: {
            $dateFromParts: {
              isoWeekYear: { $isoWeekYear: '$createdAt' },
              isoWeek: { $isoWeek: '$createdAt' },
              isoDayOfWeek: 1,
            },
          },
        },
      };
      break;
    case 'monthly':
      groupByExpression = { $dateToString: { format: '%Y-%m-01', date: '$createdAt' } };
      break;
  }

  const matchStage: any = {
    storeId: storeObjId,
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $in: ['processing', 'shipped', 'delivered'] },
  };

  if (categoryId) {
    if (!Types.ObjectId.isValid(categoryId)) throw new Error('Invalid category ID');
    const products = await Product.find({
      storeId: storeObjId,
      categoryId: new Types.ObjectId(categoryId),
      isDeleted: false,
    }).select('_id').lean();
    matchStage['items.productId'] = { $in: products.map(p => p._id) };
  }

  const trends = await Order.aggregate([
    { $match: matchStage },
    { $group: { _id: groupByExpression, revenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
    { $sort: { _id: 1 as const } },
    { $project: { date: '$_id', revenue: { $round: ['$revenue', 2] }, orderCount: 1, _id: 0 } },
  ]);

  const prev = getPreviousPeriodRange(startDate, endDate);
  const prevResult = await Order.aggregate([
    { $match: { ...matchStage, createdAt: { $gte: prev.startDate, $lte: prev.endDate } } },
    { $group: { _id: null, revenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
  ]);

  const currentRevenue = trends.reduce((s, t) => s + t.revenue, 0);
  const currentOrderCount = trends.reduce((s, t) => s + t.orderCount, 0);
  const prevRevenue = prevResult[0]?.revenue || 0;
  const prevOrderCount = prevResult[0]?.orderCount || 0;

  const result: SalesTrendsResult = {
    trends,
    previousPeriod: {
      revenue: Math.round(prevRevenue * 100) / 100,
      orderCount: prevOrderCount,
      percentageChange: calculatePercentageChange(currentRevenue, prevRevenue) as number,
    },
  };

  cacheService.set(cacheKey, result, CACHE_TTL.SALES_TRENDS);
  return result;
}

export async function getCategoryPerformance(params: DateRangeParams): Promise<CategoryPerformanceResult> {
  const { storeId, startDate, endDate } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const cacheKey = CACHE_KEYS.CATEGORY_PERFORMANCE(
    formatDateForCacheKey(startDate),
    formatDateForCacheKey(endDate)
  ) + `:${storeId}`;

  const cached = cacheService.get<CategoryPerformanceResult>(cacheKey);
  if (cached) return cached;

  const categories = await Order.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate }, status: { $in: ['processing', 'shipped', 'delivered'] } } },
    { $unwind: '$items' },
    { $lookup: { from: 'products', localField: 'items.productId', foreignField: '_id', as: 'product' } },
    { $unwind: '$product' },
    { $lookup: { from: 'categories', localField: 'product.categoryId', foreignField: '_id', as: 'category' } },
    { $unwind: '$category' },
    { $group: { _id: '$category._id', categoryName: { $first: '$category.name' }, revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } }, orderCount: { $sum: 1 } } },
    { $sort: { revenue: -1 as const } },
    { $project: { categoryId: { $toString: '$_id' }, categoryName: 1, revenue: { $round: ['$revenue', 2] }, orderCount: 1, _id: 0 } },
  ]);

  const totalRevenue = categories.reduce((s, c) => s + c.revenue, 0);
  const withPct = categories.map(c => ({
    ...c,
    percentage: totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 10000) / 100 : 0,
  }));

  const allCategories = await Category.find({ storeId: storeObjId }).lean();
  const catMap = new Map(withPct.map(c => [c.categoryId, c]));

  const result: CategoryPerformanceResult = {
    categories: allCategories
      .map(cat => catMap.get(cat._id.toString()) || { categoryId: cat._id.toString(), categoryName: cat.name, revenue: 0, percentage: 0, orderCount: 0 })
      .sort((a, b) => b.revenue - a.revenue),
    totalRevenue: Math.round(totalRevenue * 100) / 100,
  };

  cacheService.set(cacheKey, result, CACHE_TTL.CATEGORY_PERFORMANCE);
  return result;
}

export async function getCustomerMetrics(params: DateRangeParams): Promise<CustomerMetricsResult> {
  const { storeId, startDate, endDate } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const cacheKey = CACHE_KEYS.CUSTOMER_METRICS(
    formatDateForCacheKey(startDate),
    formatDateForCacheKey(endDate)
  ) + `:${storeId}`;

  const cached = cacheService.get<CustomerMetricsResult>(cacheKey);
  if (cached) return cached;

  const { User } = await import('../auth/user.model');

  const newCustomersCount = await User.countDocuments({
    storeId: storeObjId,
    createdAt: { $gte: startDate, $lte: endDate },
  });

  const repeatResult = await Order.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate }, status: { $in: ['processing', 'shipped', 'delivered'] } } },
    { $group: { _id: '$customerId', orderCount: { $sum: 1 } } },
    { $group: { _id: null, totalCustomers: { $sum: 1 }, repeatCustomers: { $sum: { $cond: [{ $gt: ['$orderCount', 1] }, 1, 0] } } } },
  ]);
  const totalCustomers = repeatResult[0]?.totalCustomers || 0;
  const repeatCustomers = repeatResult[0]?.repeatCustomers || 0;
  const repeatCustomerRate = totalCustomers > 0 ? Math.round((repeatCustomers / totalCustomers) * 10000) / 100 : 0;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  const churnResult = await Order.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $lt: ninetyDaysAgo }, status: { $in: ['processing', 'shipped', 'delivered'] } } },
    { $group: { _id: '$customerId', lastOrderDate: { $max: '$createdAt' } } },
    { $match: { lastOrderDate: { $lt: ninetyDaysAgo } } },
    { $count: 'churnedCustomers' },
  ]);
  const totalEverResult = await Order.aggregate([
    { $match: { storeId: storeObjId, status: { $in: ['processing', 'shipped', 'delivered'] } } },
    { $group: { _id: '$customerId' } },
    { $count: 'total' },
  ]);
  const churnedCustomers = churnResult[0]?.churnedCustomers || 0;
  const totalEver = totalEverResult[0]?.total || 0;
  const churnRate = totalEver > 0 ? Math.round((churnedCustomers / totalEver) * 10000) / 100 : 0;

  const acquisitionTrend = await User.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, newCustomers: { $sum: 1 } } },
    { $sort: { _id: 1 as const } },
    { $project: { date: '$_id', newCustomers: 1, _id: 0 } },
  ]);

  const prev = getPreviousPeriodRange(startDate, endDate);
  const prevNewCustomers = await User.countDocuments({
    storeId: storeObjId,
    createdAt: { $gte: prev.startDate, $lte: prev.endDate },
  });

  const result: CustomerMetricsResult = {
    newCustomers: newCustomersCount,
    repeatCustomerRate,
    churnRate,
    acquisitionTrend,
    previousPeriod: {
      newCustomers: prevNewCustomers,
      percentageChange: calculatePercentageChange(newCustomersCount, prevNewCustomers) as number,
    },
  };

  cacheService.set(cacheKey, result, CACHE_TTL.CUSTOMER_METRICS);
  return result;
}

export async function getAOVMetrics(params: DateRangeParams): Promise<AOVMetricsResult> {
  const { storeId, startDate, endDate } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const cacheKey = CACHE_KEYS.AOV_METRICS(
    formatDateForCacheKey(startDate),
    formatDateForCacheKey(endDate)
  ) + `:${storeId}`;

  const cached = cacheService.get<AOVMetricsResult>(cacheKey);
  if (cached) return cached;

  const baseMatch = { storeId: storeObjId, status: { $in: ['processing', 'shipped', 'delivered'] } };

  const [curResult] = await Order.aggregate([
    { $match: { ...baseMatch, createdAt: { $gte: startDate, $lte: endDate } } },
    { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
  ]);
  const currentAOV = curResult?.orderCount > 0 ? Math.round((curResult.totalRevenue / curResult.orderCount) * 100) / 100 : 0;

  const prev = getPreviousPeriodRange(startDate, endDate);
  const [prevResult] = await Order.aggregate([
    { $match: { ...baseMatch, createdAt: { $gte: prev.startDate, $lte: prev.endDate } } },
    { $group: { _id: null, totalRevenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
  ]);
  const previousAOV = prevResult?.orderCount > 0 ? Math.round((prevResult.totalRevenue / prevResult.orderCount) * 100) / 100 : 0;

  const trend = await Order.aggregate([
    { $match: { ...baseMatch, createdAt: { $gte: startDate, $lte: endDate } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, totalRevenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
    { $sort: { _id: 1 as const } },
    { $project: { date: '$_id', aov: { $cond: [{ $gt: ['$orderCount', 0] }, { $round: [{ $divide: ['$totalRevenue', '$orderCount'] }, 2] }, 0] }, _id: 0 } },
  ]);

  const result: AOVMetricsResult = {
    currentAOV,
    previousAOV,
    percentageChange: calculatePercentageChange(currentAOV, previousAOV) as number,
    trend,
  };

  cacheService.set(cacheKey, result, CACHE_TTL.AOV_METRICS);
  return result;
}

export async function getConversionMetrics(params: DateRangeParams): Promise<ConversionMetricsResult> {
  const { storeId, startDate, endDate } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const cacheKey = CACHE_KEYS.CONVERSION_METRICS(
    formatDateForCacheKey(startDate),
    formatDateForCacheKey(endDate)
  ) + `:${storeId}`;

  const cached = cacheService.get<ConversionMetricsResult>(cacheKey);
  if (cached) return cached;

  const { User } = await import('../auth/user.model');

  const currentOrders = await Order.countDocuments({
    storeId: storeObjId,
    createdAt: { $gte: startDate, $lte: endDate },
    status: { $in: ['processing', 'shipped', 'delivered'] },
  });
  const totalUsers = await User.countDocuments({ storeId: storeObjId, createdAt: { $lte: endDate } });
  const currentConversionRate = totalUsers > 0 ? Math.round((currentOrders / totalUsers) * 10000) / 100 : 0;

  const prev = getPreviousPeriodRange(startDate, endDate);
  const prevOrders = await Order.countDocuments({
    storeId: storeObjId,
    createdAt: { $gte: prev.startDate, $lte: prev.endDate },
    status: { $in: ['processing', 'shipped', 'delivered'] },
  });
  const prevUsers = await User.countDocuments({ storeId: storeObjId, createdAt: { $lte: prev.endDate } });
  const previousConversionRate = prevUsers > 0 ? Math.round((prevOrders / prevUsers) * 10000) / 100 : 0;

  const ordersByDay = await Order.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate }, status: { $in: ['processing', 'shipped', 'delivered'] } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orderCount: { $sum: 1 } } },
    { $sort: { _id: 1 as const } },
  ]);

  const trend = ordersByDay.map(day => ({
    date: day._id,
    conversionRate: totalUsers > 0 ? Math.round((day.orderCount / totalUsers) * 10000) / 100 : 0,
  }));

  const result: ConversionMetricsResult = {
    conversionRate: currentConversionRate,
    previousConversionRate,
    percentageChange: calculatePercentageChange(currentConversionRate, previousConversionRate) as number,
    trend,
  };

  cacheService.set(cacheKey, result, CACHE_TTL.CONVERSION_METRICS);
  return result;
}

export async function getTodayMetrics(storeId: string): Promise<TodayMetricsResult> {
  const storeObjId = new Types.ObjectId(storeId);
  const cacheKey = CACHE_KEYS.TODAY_METRICS + `:${storeId}`;

  const cached = cacheService.get<TodayMetricsResult>(cacheKey);
  if (cached) return cached;

  const { User } = await import('../auth/user.model');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const yesterdayStart = new Date(todayStart); yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const yesterdayEnd = new Date(todayEnd); yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

  const baseMatch = { storeId: storeObjId, status: { $in: ['processing', 'shipped', 'delivered'] } };

  const [todayResult] = await Order.aggregate([
    { $match: { ...baseMatch, createdAt: { $gte: todayStart, $lte: todayEnd } } },
    { $group: { _id: null, revenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
  ]);
  const [yesterdayResult] = await Order.aggregate([
    { $match: { ...baseMatch, createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd } } },
    { $group: { _id: null, revenue: { $sum: '$totalAmount' }, orderCount: { $sum: 1 } } },
  ]);

  const activeUsers = await User.countDocuments({
    storeId: storeObjId,
    createdAt: { $gte: new Date(Date.now() - 86400000) },
  });

  const result: TodayMetricsResult = {
    today: {
      revenue: Math.round((todayResult?.revenue || 0) * 100) / 100,
      orderCount: todayResult?.orderCount || 0,
      activeUsers,
    },
    yesterday: {
      revenue: Math.round((yesterdayResult?.revenue || 0) * 100) / 100,
      orderCount: yesterdayResult?.orderCount || 0,
    },
    changes: {
      revenueChange: calculatePercentageChange(todayResult?.revenue || 0, yesterdayResult?.revenue || 0) as number,
      orderCountChange: calculatePercentageChange(todayResult?.orderCount || 0, yesterdayResult?.orderCount || 0) as number,
    },
  };

  cacheService.set(cacheKey, result, CACHE_TTL.TODAY_METRICS);
  return result;
}

export async function getRecentOrders(storeId: string, limit: number): Promise<RecentOrdersResult> {
  const storeObjId = new Types.ObjectId(storeId);
  const cacheKey = CACHE_KEYS.RECENT_ORDERS(limit) + `:${storeId}`;

  const cached = cacheService.get<RecentOrdersResult>(cacheKey);
  if (cached) return cached;

  const orders = await Order.aggregate([
    { $match: { storeId: storeObjId } },
    { $sort: { createdAt: -1 as const } },
    { $limit: limit },
    { $lookup: { from: 'users', localField: 'customerId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        orderId: { $toString: '$_id' },
        customerName: { $ifNull: ['$user.email', 'Guest'] },
        totalAmount: { $round: ['$totalAmount', 2] },
        status: 1,
        createdAt: 1,
        _id: 0,
      },
    },
  ]);

  const result: RecentOrdersResult = {
    orders: orders.map(o => ({
      ...o,
      createdAt: new Date(o.createdAt).toISOString(),
      relativeTime: relativeTime(new Date(o.createdAt)),
    })),
  };

  cacheService.set(cacheKey, result, CACHE_TTL.RECENT_ORDERS);
  return result;
}

export async function getRevenueGoal(storeId: string, period: 'daily' | 'weekly' | 'monthly'): Promise<RevenueGoalResult> {
  const storeObjId = new Types.ObjectId(storeId);
  const cacheKey = CACHE_KEYS.REVENUE_GOAL(period) + `:${storeId}`;

  const cached = cacheService.get<RevenueGoalResult>(cacheKey);
  if (cached) return cached;

  const now = new Date();
  let startDate: Date, endDate: Date, goalAmount: number;

  switch (period) {
    case 'daily':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      goalAmount = 10000;
      break;
    case 'weekly': {
      const dow = now.getDay();
      startDate = new Date(now); startDate.setDate(now.getDate() - dow); startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate); endDate.setDate(startDate.getDate() + 6); endDate.setHours(23, 59, 59, 999);
      goalAmount = 50000;
      break;
    }
    case 'monthly':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      goalAmount = 200000;
      break;
  }

  const [revenueResult] = await Order.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate }, status: { $in: ['processing', 'shipped', 'delivered'] } } },
    { $group: { _id: null, revenue: { $sum: '$totalAmount' } } },
  ]);
  const currentRevenue = revenueResult?.revenue || 0;

  const result: RevenueGoalResult = {
    currentRevenue: Math.round(currentRevenue * 100) / 100,
    goalAmount,
    percentage: goalAmount > 0 ? Math.min(Math.round((currentRevenue / goalAmount) * 10000) / 100, 100) : 0,
    isExceeded: currentRevenue > goalAmount,
  };

  cacheService.set(cacheKey, result, CACHE_TTL.REVENUE_GOAL);
  return result;
}
