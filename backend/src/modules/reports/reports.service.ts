import { Types } from 'mongoose';
import { Product } from '../products/product.model';
import { Order } from '../orders/order.model';
import { NET_REVENUE_EXPR, REVENUE_RECOGNITION_CLAUSES, revenueMatch } from '../../utils/revenue';

export interface InventoryReportParams {
  storeId: string;
  status: 'low' | 'out' | 'overstocked' | 'all';
  page: number;
  limit: number;
  search?: string;
}

export interface InventoryReportResult {
  products: Array<{
    productId: string;
    productName: string;
    categoryName: string;
    stock: number;
    status: 'low' | 'out' | 'overstocked' | 'normal';
  }>;
  pagination: { currentPage: number; totalPages: number; totalItems: number };
}

export interface SalesReportParams {
  storeId: string;
  startDate: Date;
  endDate: Date;
  page: number;
  limit: number;
  search?: string;
}

export interface SalesReportResult {
  sales: Array<{ orderDate: string; orderId: string; customerName: string; totalAmount: number; status: string }>;
  pagination: { currentPage: number; totalPages: number; totalItems: number };
  summary: { totalRevenue: number; totalOrders: number };
}

export interface ProductPerformanceParams {
  storeId: string;
  startDate: Date;
  endDate: Date;
  type: 'best' | 'worst';
  limit: number;
}

export interface ProductPerformanceResult {
  products: Array<{ productId: string; productName: string; unitsSold: number; totalRevenue: number }>;
  type: 'best' | 'worst';
}

// ── Inventory Report ──────────────────────────────────────────────────────────

export async function getInventoryReport(params: InventoryReportParams): Promise<InventoryReportResult> {
  const { storeId, status, page, limit, search } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const pipeline: any[] = [
    { $match: { storeId: storeObjId, isDeleted: false } },
    { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'category' } },
    { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $eq: ['$stock', 0] }, then: 'out' },
              { case: { $lt: ['$stock', 10] }, then: 'low' },
              { case: { $gt: ['$stock', 100] }, then: 'overstocked' },
            ],
            default: 'normal',
          },
        },
      },
    },
  ];

  if (search?.trim()) {
    const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pipeline.push({
      $match: {
        $or: [
          { name: { $regex: safeSearch, $options: 'i' } },
          { 'category.name': { $regex: safeSearch, $options: 'i' } },
        ],
      },
    });
  }

  if (status !== 'all') {
    pipeline.push({ $match: { status } });
  }

  const countResult = await Product.aggregate([...pipeline, { $count: 'total' }]);
  const totalItems = countResult[0]?.total || 0;

  pipeline.push(
    { $skip: (page - 1) * limit },
    { $limit: limit },
    {
      $project: {
        productId: { $toString: '$_id' },
        productName: '$name',
        categoryName: { $ifNull: ['$category.name', 'Uncategorized'] },
        stock: 1,
        status: 1,
        _id: 0,
      },
    }
  );

  const products = await Product.aggregate(pipeline);

  return {
    products,
    pagination: { currentPage: page, totalPages: Math.ceil(totalItems / limit), totalItems },
  };
}

// ── Sales Report ──────────────────────────────────────────────────────────────

export async function getSalesReport(params: SalesReportParams): Promise<SalesReportResult> {
  const { storeId, startDate, endDate, page, limit, search } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const matchStage: any = {
    storeId: storeObjId,
    createdAt: { $gte: startDate, $lte: endDate },
  };

  const pipeline: any[] = [
    { $match: matchStage },
    { $lookup: { from: 'users', localField: 'customerId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
  ];

  if (search?.trim()) {
    const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchConditions: any[] = [
      { 'user.email': { $regex: safeSearch, $options: 'i' } },
    ];
    if (Types.ObjectId.isValid(search.trim())) {
      searchConditions.push({ _id: new Types.ObjectId(search.trim()) });
    }
    pipeline.push({ $match: { $or: searchConditions } });
  }

  pipeline.push(
    {
      $project: {
        orderDate: '$createdAt',
        orderId: { $toString: '$_id' },
        customerName: { $ifNull: ['$user.email', 'Guest'] },
        totalAmount: { $round: ['$totalAmount', 2] },
        status: 1,
        _id: 0,
      },
    },
    { $sort: { orderDate: -1 as const } }
  );

  const countPipeline = [...pipeline.slice(0, search ? 3 : 2), { $count: 'total' }];
  const countResult = await Order.aggregate(countPipeline);
  const totalItems = countResult[0]?.total || 0;

  const sales = await Order.aggregate([...pipeline, { $skip: (page - 1) * limit }, { $limit: limit }]);

  // The LIST above shows every order in the range, including unpaid ones — that
  // is what an order report is for. The SUMMARY must not: revenue counts only
  // money actually taken, or the report's own total disagrees with the
  // dashboard beside it.
  const [summaryResult] = await Order.aggregate([
    { $match: revenueMatch(matchStage) },
    { $group: { _id: null, totalRevenue: { $sum: NET_REVENUE_EXPR }, totalOrders: { $sum: 1 } } },
  ]);

  return {
    sales: sales.map(s => ({ ...s, orderDate: new Date(s.orderDate).toISOString() })),
    pagination: { currentPage: page, totalPages: Math.ceil(totalItems / limit), totalItems },
    summary: {
      totalRevenue: Math.round((summaryResult?.totalRevenue || 0) * 100) / 100,
      totalOrders: summaryResult?.totalOrders || 0,
    },
  };
}

// ── Export Sales Report (CSV) ─────────────────────────────────────────────────

export async function exportSalesReport(params: { storeId: string; startDate: Date; endDate: Date }): Promise<string> {
  const { storeId, startDate, endDate } = params;
  const storeObjId = new Types.ObjectId(storeId);

  const sales = await Order.aggregate([
    { $match: { storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate } } },
    { $lookup: { from: 'users', localField: 'customerId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        orderDate: '$createdAt',
        orderId: { $toString: '$_id' },
        customerName: { $ifNull: ['$user.email', 'Guest'] },
        totalAmount: { $round: ['$totalAmount', 2] },
        status: 1,
        _id: 0,
      },
    },
    { $sort: { orderDate: -1 as const } },
  ]);

  const escape = (v: any) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [
    ['Order Date', 'Order ID', 'Customer Name', 'Total Amount', 'Status'].join(','),
    ...sales.map(s => [
      escape(new Date(s.orderDate).toISOString()),
      escape(s.orderId),
      escape(s.customerName),
      escape(s.totalAmount),
      escape(s.status),
    ].join(',')),
  ];

  return rows.join('\n');
}

// ── Product Performance ───────────────────────────────────────────────────────

export async function getProductPerformance(params: ProductPerformanceParams): Promise<ProductPerformanceResult> {
  const { storeId, startDate, endDate, type, limit } = params;
  const storeObjId = new Types.ObjectId(storeId);

  // Line revenue prorated by the order's discount — the same treatment
  // `admin.getTopProducts` applies. Summing list prices meant a coupon never
  // reduced a product's reported revenue, so the per-product figures could add
  // up to more than the store actually took.
  const salesData = await Order.aggregate([
    { $match: revenueMatch({ storeId: storeObjId, createdAt: { $gte: startDate, $lte: endDate } }) },
    {
      $addFields: {
        __share: {
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
        },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        unitsSold: { $sum: '$items.quantity' },
        totalRevenue: {
          $sum: {
            $multiply: [{ $multiply: ['$items.quantity', '$items.price'] }, '$__share'],
          },
        },
      },
    },
  ]);

  const salesMap = new Map(salesData.map(i => [i._id.toString(), { unitsSold: i.unitsSold, totalRevenue: i.totalRevenue }]));

  const allProducts = await Product.find({ storeId: storeObjId, isDeleted: false }).select('_id name').lean();

  const productsWithSales = allProducts.map(p => {
    const s = salesMap.get(p._id.toString());
    return {
      productId: p._id.toString(),
      productName: p.name,
      unitsSold: s?.unitsSold || 0,
      totalRevenue: s ? Math.round(s.totalRevenue * 100) / 100 : 0,
    };
  });

  productsWithSales.sort((a, b) =>
    type === 'best'
      ? b.unitsSold !== a.unitsSold ? b.unitsSold - a.unitsSold : b.totalRevenue - a.totalRevenue
      : a.unitsSold !== b.unitsSold ? a.unitsSold - b.unitsSold : a.totalRevenue - b.totalRevenue
  );

  return { products: productsWithSales.slice(0, limit), type };
}
