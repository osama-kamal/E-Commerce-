import { Types } from 'mongoose';
import { Order } from '../orders/order.model';
import { User } from '../auth/user.model';
import { Product } from '../products/product.model';
// `Payment` is deliberately not imported any more: revenue comes from orders,
// and payments are reconciliation only. See utils/revenue.ts.
import { createError } from '../../middleware/errorHandler';
import { cacheService } from '../../services/cache.service';
import {
  revenueMatch,
  REVENUE_BY_CURRENCY_STAGES,
  headlineRevenue,
  RevenueByCurrency,
} from '../../utils/revenue';

// Cache TTLs for admin aggregations (seconds)
const ADMIN_CACHE_TTL = {
  DASHBOARD_STATS: 300,   // 5 minutes — heavy multi-collection aggregation
  TOP_PRODUCTS: 300,      // 5 minutes — order unwind + group
} as const;

// ── Dashboard summary ──────────────────────────────────────────────────────────

export interface DashboardStats {
  /** Net revenue in the store's own currency. See utils/revenue.ts. */
  totalRevenue: number;
  /** ISO code `totalRevenue` is expressed in. */
  currency: string;
  /**
   * Per-currency breakdown. Normally one row; more than one means the store has
   * orders in several currencies, which must never be summed into a single
   * figure — surfacing the split is the point.
   */
  revenueByCurrency: RevenueByCurrency[];
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

  // The currency the merchant prices in — used to pick which per-currency row
  // headlines the dashboard, never to convert between them.
  const { Store } = await import('../stores/store.model');
  const store = await Store.findById(storeObjId).select('currency').lean();
  const storeCurrency = (store?.currency ?? 'USD').toUpperCase();

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
    // Revenue from ORDERS, tenant-filtered in the first stage.
    //
    // This replaced an aggregation over `payments` that matched
    // `{ status: 'succeeded' }` with NO tenant filter, $lookup'd the entire
    // orders collection, and only then filtered by storeId. Its output was
    // correctly scoped — nothing leaked — but every merchant's dashboard load
    // did platform-wide work, growing with total volume rather than the
    // store's own.
    //
    // Three further defects went with it:
    //   · cash-on-delivery was invisible, because COD creates no Payment row;
    //   · the date filter applied to the PAYMENT's date while the order counts
    //     beside it used the ORDER's, so the two figures on one screen covered
    //     different populations;
    //   · Payment.amount is in minor units while every other money field on the
    //     order is in major units.
    //
    // Orders carry the full breakdown, cover COD, and are one document per sale.
    Order.aggregate([
      { $match: revenueMatch({ storeId: storeObjId, ...dateFilter }) },
      ...REVENUE_BY_CURRENCY_STAGES,
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

  const revenueByCurrency = revenueResult as RevenueByCurrency[];
  const totalRevenue = headlineRevenue(revenueByCurrency, storeCurrency);

  const ordersByStatus: Record<string, number> = {};
  for (const row of ordersByStatusRaw) {
    ordersByStatus[row._id as string] = row.count as number;
  }

  const result: DashboardStats = {
    totalRevenue,
    currency: storeCurrency,
    revenueByCurrency,
    totalOrders,
    totalUsers,
    newCustomers,
    ordersByStatus,
    stockAlerts: stockAlerts as unknown as { _id: Types.ObjectId; name: string; stock: number }[],
  };

  cacheService.set(cacheKey, result, ADMIN_CACHE_TTL.DASHBOARD_STATS);
  return result;
}

/**
 * Amount refunded per product, from the refund ledger.
 *
 * `Refund.lines` already carries `productId` and the prorated
 * `subtotalRefunded`, so no re-derivation is needed — this is the same figure
 * the customer got back for that item.
 *
 * Only `succeeded` refunds count: a `pending` one may still fail and release
 * its reservation, and a `failed` one returned nothing.
 */
async function refundedTotalsByProduct(
  storeId: Types.ObjectId,
  productIds: Types.ObjectId[],
  startDate?: Date,
  endDate?: Date
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const { Refund } = await import('../refunds/refund.model');

  const rows = await Refund.aggregate([
    {
      $match: {
        storeId,
        status: 'succeeded',
        ...(startDate || endDate
          ? {
              createdAt: {
                ...(startDate && { $gte: startDate }),
                ...(endDate && { $lte: endDate }),
              },
            }
          : {}),
      },
    },
    { $unwind: '$lines' },
    { $match: { 'lines.productId': { $in: productIds } } },
    { $group: { _id: '$lines.productId', refunded: { $sum: '$lines.subtotalRefunded' } } },
  ]);

  return new Map(rows.map((r) => [r._id.toString(), r.refunded as number]));
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

  // Line revenue, prorated by the order's discount.
  //
  // This summed `price × quantity` — the LIST price — so a coupon never reduced
  // a product's reported revenue and the per-product figures could exceed the
  // store's actual takings. Each line is scaled by the share of the order that
  // was actually collected, matching how the refund engine prorates.
  const lineShare = {
    $cond: [
      { $gt: [{ $ifNull: ['$subtotal', 0] }, 0] },
      {
        $divide: [
          { $subtract: [{ $ifNull: ['$subtotal', 0] }, { $ifNull: ['$discountAmount', 0] }] },
          '$subtotal',
        ],
      },
      1,
    ],
  };

  const grouped = await Order.aggregate([
    { $match: revenueMatch({ storeId: storeObjId, ...dateFilter }) },
    { $addFields: { __share: lineShare } },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.name' },
        unitsSold: { $sum: '$items.quantity' },
        revenue: {
          $sum: {
            $multiply: [{ $multiply: ['$items.price', '$items.quantity'] }, '$__share'],
          },
        },
      },
    },
    { $sort: { unitsSold: -1 } },
    { $limit: limit },
    { $project: { _id: 0, productId: '$_id', name: 1, unitsSold: 1, revenue: 1 } },
  ]);

  // Refunds are attributed per product from the refund lines, which carry
  // productId and the prorated amount already. Done as a second query rather
  // than a $lookup: it touches only this store's refunds and keeps the join off
  // the hot aggregation.
  const refundsByProduct = await refundedTotalsByProduct(
    storeObjId,
    grouped.map((g) => g.productId),
    startDate,
    endDate
  );

  const results: TopProduct[] = grouped.map((row) => {
    const refunded = refundsByProduct.get(row.productId.toString()) ?? 0;
    return {
      productId: row.productId,
      name: row.name,
      unitsSold: row.unitsSold,
      revenue: Math.round(Math.max(0, row.revenue - refunded) * 100) / 100,
    };
  });

  cacheService.set(cacheKey, results, ADMIN_CACHE_TTL.TOP_PRODUCTS);
  return results;
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

  // A super-admin's role cannot be changed through this endpoint. It is guarded
  // only by authorizeRole('admin'), so without this any store admin could demote
  // the platform's most privileged account to customer — and the two-option UI
  // that feeds it renders a super-admin as "customer", making that a one-click
  // accident with no way back from the same screen. Refuse before writing, and
  // scope the lookup to the store so an admin cannot touch another tenant's user.
  const target = await User.findOne({
    _id: userId,
    storeId: new Types.ObjectId(storeId),
  }).select('role').lean();

  if (!target) throw createError('User not found', 404, 'NOT_FOUND');
  if (target.role === 'super-admin') {
    throw createError("A super-admin's role cannot be changed", 403, 'FORBIDDEN');
  }

  const user = await User.findByIdAndUpdate(
    userId,
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
