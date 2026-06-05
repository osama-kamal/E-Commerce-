import { Types } from 'mongoose';
import { Order } from '../orders/order.model';
import { User } from '../auth/user.model';
import { Product } from '../products/product.model';
import { Payment } from '../payments/payment.model';
import { createError } from '../../middleware/errorHandler';
import { cacheService } from '../../services/cache.service';

// Cache TTLs for admin aggregations (seconds)
const ADMIN_CACHE_TTL = {
  DASHBOARD_STATS: 300,   // 5 minutes — heavy multi-collection aggregation
  TOP_PRODUCTS: 300,      // 5 minutes — order unwind + group
} as const;

// ── Dashboard summary ──────────────────────────────────────────────────────────

export interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  totalUsers: number;
  newCustomers: number;
  ordersByStatus: Record<string, number>;
  stockAlerts: { _id: Types.ObjectId; name: string; stock: number }[];
}

export async function getDashboardStats(
  storeId: string,
  startDate?: Date,
  endDate?: Date
): Promise<DashboardStats> {
  const storeObjId = new Types.ObjectId(storeId);

  // Build a deterministic cache key from all inputs
  const cacheKey = `admin:dashboard:${storeId}:${startDate?.toISOString() ?? 'none'}:${endDate?.toISOString() ?? 'none'}`;
  const cached = cacheService.get<DashboardStats>(cacheKey);
  if (cached) return cached;

  const dateFilter =
    startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { $gte: startDate }),
            ...(endDate && { $lte: endDate }),
          },
        }
      : {};

  const [
    revenueResult,
    totalOrders,
    totalUsers,
    newCustomers,
    ordersByStatusRaw,
    stockAlerts,
  ] = await Promise.all([
    Payment.aggregate([
      { $match: { status: 'succeeded', ...dateFilter } },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order',
        },
      },
      { $unwind: '$order' },
      { $match: { 'order.storeId': storeObjId } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    Order.countDocuments({ storeId: storeObjId, ...dateFilter }),

    User.countDocuments({ storeId: storeObjId, role: 'customer' }),

    User.countDocuments({ storeId: storeObjId, role: 'customer', ...dateFilter }),

    Order.aggregate([
      { $match: { storeId: storeObjId, ...dateFilter } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),

    Product.find({ storeId: storeObjId, isDeleted: false, stock: { $lt: 5 } })
      .select('name stock')
      .sort({ stock: 1 })
      .lean(),
  ]);

  const totalRevenue = Math.round(((revenueResult[0]?.total ?? 0) / 100) * 100) / 100;

  const ordersByStatus: Record<string, number> = {};
  for (const row of ordersByStatusRaw) {
    ordersByStatus[row._id as string] = row.count as number;
  }

  const result: DashboardStats = {
    totalRevenue,
    totalOrders,
    totalUsers,
    newCustomers,
    ordersByStatus,
    stockAlerts: stockAlerts as unknown as { _id: Types.ObjectId; name: string; stock: number }[],
  };

  cacheService.set(cacheKey, result, ADMIN_CACHE_TTL.DASHBOARD_STATS);
  return result;
}

// ── Top-selling products ───────────────────────────────────────────────────────

export interface TopProduct {
  productId: Types.ObjectId;
  name: string;
  unitsSold: number;
  revenue: number;
}

export async function getTopProducts(
  storeId: string,
  limit = 10,
  startDate?: Date,
  endDate?: Date
): Promise<TopProduct[]> {
  const storeObjId = new Types.ObjectId(storeId);

  const cacheKey = `admin:top-products:${storeId}:${limit}:${startDate?.toISOString() ?? 'none'}:${endDate?.toISOString() ?? 'none'}`;
  const cached = cacheService.get<TopProduct[]>(cacheKey);
  if (cached) return cached;

  const dateFilter =
    startDate || endDate
      ? {
          createdAt: {
            ...(startDate && { $gte: startDate }),
            ...(endDate && { $lte: endDate }),
          },
        }
      : {};

  const results = await Order.aggregate([
    { $match: { storeId: storeObjId, status: { $in: ['processing', 'shipped', 'delivered'] }, ...dateFilter } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.name' },
        unitsSold: { $sum: '$items.quantity' },
        revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
      },
    },
    { $sort: { unitsSold: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: 1,
        unitsSold: 1,
        revenue: { $round: ['$revenue', 2] },
      },
    },
  ]);

  cacheService.set(cacheKey, results, ADMIN_CACHE_TTL.TOP_PRODUCTS);
  return results as TopProduct[];
}

// ── User management ────────────────────────────────────────────────────────────

export interface UserListItem {
  _id: Types.ObjectId;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
}

export interface PaginatedUsers {
  data: UserListItem[];
  total: number;
  page: number;
  totalPages: number;
}

export async function listUsers(
  storeId: string,
  page: number,
  limit: number,
  role?: 'admin' | 'customer'
): Promise<PaginatedUsers> {
  const skip = (page - 1) * limit;

  // No role filter by default — show all users (admins + customers).
  // Pass role to narrow the list when the UI needs it.
  const query: Record<string, unknown> = { storeId: new Types.ObjectId(storeId) };
  if (role) query.role = role;

  const [data, total] = await Promise.all([
    User.find(query)
      .select('email role isActive createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(query),
  ]);

  return {
    data: data as unknown as UserListItem[],
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getUserById(storeId: string, userId: string): Promise<UserListItem> {
  if (!Types.ObjectId.isValid(userId)) {
    throw createError('Invalid user ID', 400, 'BAD_REQUEST');
  }
  const user = await User.findOne({
    _id: userId,
    storeId: new Types.ObjectId(storeId),
  }).select('email role isActive createdAt').lean();
  if (!user) throw createError('User not found', 404, 'NOT_FOUND');
  return user as unknown as UserListItem;
}

export async function toggleUserStatus(
  storeId: string,
  userId: string,
  isActive: boolean
): Promise<UserListItem> {
  if (!Types.ObjectId.isValid(userId)) {
    throw createError('Invalid user ID', 400, 'BAD_REQUEST');
  }
  const user = await User.findOneAndUpdate(
    { _id: userId, storeId: new Types.ObjectId(storeId) },
    { isActive },
    { new: true }
  ).select('email role isActive createdAt').lean();

  if (!user) throw createError('User not found', 404, 'NOT_FOUND');
  return user as unknown as UserListItem;
}

export async function updateUserRole(
  storeId: string,
  userId: string,
  role: 'admin' | 'customer'
): Promise<UserListItem> {
  if (!Types.ObjectId.isValid(userId)) {
    throw createError('Invalid user ID', 400, 'BAD_REQUEST');
  }
  const user = await User.findOneAndUpdate(
    { _id: userId, storeId: new Types.ObjectId(storeId) },
    { role },
    { new: true }
  ).select('email role isActive createdAt').lean();

  if (!user) throw createError('User not found', 404, 'NOT_FOUND');
  return user as unknown as UserListItem;
}

// ── Advanced order management ──────────────────────────────────────────────────

export interface OrderFilters {
  storeId: string;
  page: number;
  limit: number;
  status?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface PaginatedOrders {
  data: unknown[];
  total: number;
  page: number;
  totalPages: number;
}

export async function filterOrders(filters: OrderFilters): Promise<PaginatedOrders> {
  const query: Record<string, unknown> = {
    storeId: new Types.ObjectId(filters.storeId),
  };

  if (filters.status) query.status = filters.status;

  if (filters.userId) {
    if (!Types.ObjectId.isValid(filters.userId)) {
      throw createError('Invalid user ID', 400, 'BAD_REQUEST');
    }
    query.customerId = new Types.ObjectId(filters.userId);
  }

  if (filters.startDate || filters.endDate) {
    query.createdAt = {
      ...(filters.startDate && { $gte: filters.startDate }),
      ...(filters.endDate && { $lte: filters.endDate }),
    };
  }

  const skip = (filters.page - 1) * filters.limit;

  const [data, total] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(filters.limit).lean(),
    Order.countDocuments(query),
  ]);

  return {
    data,
    total,
    page: filters.page,
    totalPages: Math.ceil(total / filters.limit),
  };
}

// ── Low stock alerts ───────────────────────────────────────────────────────────

export interface LowStockProduct {
  _id: string;
  name: string;
  stock: number;
  images: string[];
}

export interface LowStockResult {
  count: number;
  products: LowStockProduct[];
  threshold: number;
}

export async function getLowStockProducts(storeId: string, threshold = 10): Promise<LowStockResult> {
  const products = await Product.find({
    storeId: new Types.ObjectId(storeId),
    isDeleted: false,
    stock: { $lte: threshold },
  })
    .select('name stock images')
    .sort({ stock: 1 })
    .limit(50)
    .lean();

  return {
    count: products.length,
    threshold,
    products: products.map(p => ({
      _id: p._id.toString(),
      name: p.name,
      stock: p.stock,
      images: p.images,
    })),
  };
}
