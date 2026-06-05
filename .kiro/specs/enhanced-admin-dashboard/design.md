# Design Document: Enhanced Admin Dashboard

## Overview

The Enhanced Admin Dashboard extends the existing basic admin dashboard with comprehensive analytics, reporting, and real-time monitoring capabilities. The design follows a layered architecture with:

- **Backend API Layer**: RESTful endpoints using Express/TypeScript with MongoDB aggregation pipelines
- **Service Layer**: Business logic for metrics calculation, data aggregation, and caching
- **Data Layer**: MongoDB models and aggregation pipelines optimized with indexes
- **Frontend Layer**: React/TypeScript components with Recharts for visualization
- **Caching Layer**: In-memory cache for frequently accessed metrics

The system prioritizes performance through efficient aggregation queries, strategic caching, pagination, and lazy loading. All monetary values are in USD, and the design supports flexible date range filtering across all metrics.

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (React/TS)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Dashboard  │  │    Charts    │  │   Filters    │      │
│  │  Components  │  │  (Recharts)  │  │  Component   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP/REST
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend API (Express/TS)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Analytics  │  │   Reports    │  │    Cache     │      │
│  │  Controller  │  │  Controller  │  │   Manager    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│           │                 │                 │              │
│           ▼                 ▼                 ▼              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Analytics  │  │   Reports    │  │    Cache     │      │
│  │   Service    │  │   Service    │  │   Service    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ Aggregation Queries
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      MongoDB Database                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │    Orders    │  │   Products   │  │    Users     │      │
│  │  Collection  │  │  Collection  │  │  Collection  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Interaction**: Administrator selects filters (date range, category, status)
2. **API Request**: Frontend sends request with filter parameters
3. **Cache Check**: Backend checks if cached data exists and is valid
4. **Data Aggregation**: If cache miss, execute MongoDB aggregation pipeline
5. **Response**: Return formatted data with proper error handling
6. **Visualization**: Frontend renders charts and metrics using Recharts
7. **Cache Update**: Store results in cache with TTL

## Components and Interfaces

### Backend API Endpoints

#### Analytics Endpoints

**GET /api/admin/analytics/sales-trends**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
  - `granularity` (enum: 'daily' | 'weekly' | 'monthly', default: 'daily')
  - `categoryId` (string, optional)
- Response:
```typescript
{
  trends: Array<{
    date: string;
    revenue: number;
    orderCount: number;
  }>;
  previousPeriod: {
    revenue: number;
    orderCount: number;
    percentageChange: number;
  };
}
```

**GET /api/admin/analytics/category-performance**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
- Response:
```typescript
{
  categories: Array<{
    categoryId: string;
    categoryName: string;
    revenue: number;
    percentage: number;
    orderCount: number;
  }>;
  totalRevenue: number;
}
```

**GET /api/admin/analytics/customer-metrics**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
- Response:
```typescript
{
  newCustomers: number;
  repeatCustomerRate: number;
  churnRate: number;
  acquisitionTrend: Array<{
    date: string;
    newCustomers: number;
  }>;
  previousPeriod: {
    newCustomers: number;
    percentageChange: number;
  };
}
```

**GET /api/admin/analytics/aov-metrics**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
- Response:
```typescript
{
  currentAOV: number;
  previousAOV: number;
  percentageChange: number;
  trend: Array<{
    date: string;
    aov: number;
  }>;
}
```

**GET /api/admin/analytics/conversion-metrics**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
- Response:
```typescript
{
  conversionRate: number;
  previousConversionRate: number;
  percentageChange: number;
  trend: Array<{
    date: string;
    conversionRate: number;
  }>;
}
```

**GET /api/admin/analytics/today-metrics**
- No query parameters (always returns today vs yesterday)
- Response:
```typescript
{
  today: {
    revenue: number;
    orderCount: number;
    activeUsers: number;
  };
  yesterday: {
    revenue: number;
    orderCount: number;
  };
  changes: {
    revenueChange: number;
    orderCountChange: number;
  };
}
```

**GET /api/admin/analytics/recent-orders**
- Query Parameters:
  - `limit` (number, default: 10, max: 50)
- Response:
```typescript
{
  orders: Array<{
    orderId: string;
    customerName: string;
    totalAmount: number;
    status: string;
    createdAt: string;
    relativeTime: string;
  }>;
}
```

**GET /api/admin/analytics/revenue-goal**
- Query Parameters:
  - `period` (enum: 'daily' | 'weekly' | 'monthly', default: 'monthly')
- Response:
```typescript
{
  currentRevenue: number;
  goalAmount: number;
  percentage: number;
  isExceeded: boolean;
}
```

#### Report Endpoints

**GET /api/admin/reports/inventory**
- Query Parameters:
  - `status` (enum: 'low' | 'out' | 'overstocked' | 'all', default: 'all')
  - `page` (number, default: 1)
  - `limit` (number, default: 50)
- Response:
```typescript
{
  products: Array<{
    productId: string;
    productName: string;
    categoryName: string;
    stock: number;
    status: 'low' | 'out' | 'overstocked' | 'normal';
  }>;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
  };
}
```

**GET /api/admin/reports/sales**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
  - `page` (number, default: 1)
  - `limit` (number, default: 50)
- Response:
```typescript
{
  sales: Array<{
    orderDate: string;
    orderId: string;
    customerName: string;
    totalAmount: number;
    status: string;
  }>;
  pagination: {
    currentPage: number;
    totalPages: number;
    totalItems: number;
  };
  summary: {
    totalRevenue: number;
    totalOrders: number;
  };
}
```

**GET /api/admin/reports/sales/export**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
- Response: CSV file download
- Headers: `Content-Type: text/csv`, `Content-Disposition: attachment; filename="sales-report-{startDate}-{endDate}.csv"`

**GET /api/admin/reports/product-performance**
- Query Parameters:
  - `startDate` (ISO 8601 date string, required)
  - `endDate` (ISO 8601 date string, required)
  - `type` (enum: 'best' | 'worst', default: 'best')
  - `limit` (number, default: 10, max: 50)
- Response:
```typescript
{
  products: Array<{
    productId: string;
    productName: string;
    unitsSold: number;
    totalRevenue: number;
  }>;
  type: 'best' | 'worst';
}
```

### Service Layer Interfaces

**AnalyticsService**
```typescript
interface AnalyticsService {
  getSalesTrends(params: SalesTrendsParams): Promise<SalesTrendsResult>;
  getCategoryPerformance(params: DateRangeParams): Promise<CategoryPerformanceResult>;
  getCustomerMetrics(params: DateRangeParams): Promise<CustomerMetricsResult>;
  getAOVMetrics(params: DateRangeParams): Promise<AOVMetricsResult>;
  getConversionMetrics(params: DateRangeParams): Promise<ConversionMetricsResult>;
  getTodayMetrics(): Promise<TodayMetricsResult>;
  getRecentOrders(limit: number): Promise<RecentOrdersResult>;
  getRevenueGoal(period: 'daily' | 'weekly' | 'monthly'): Promise<RevenueGoalResult>;
}
```

**ReportsService**
```typescript
interface ReportsService {
  getInventoryReport(params: InventoryReportParams): Promise<InventoryReportResult>;
  getSalesReport(params: SalesReportParams): Promise<SalesReportResult>;
  exportSalesReport(params: DateRangeParams): Promise<string>; // Returns CSV string
  getProductPerformance(params: ProductPerformanceParams): Promise<ProductPerformanceResult>;
}
```

**CacheService**
```typescript
interface CacheService {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T, ttlSeconds: number): void;
  invalidate(pattern: string): void;
  clear(): void;
}
```

### Frontend Component Structure

**DashboardContainer**
- Manages global state (filters, date range)
- Coordinates data fetching
- Handles error boundaries

**FilterPanel**
- Date range picker
- Category selector
- Status selector
- Period comparison toggle

**MetricsGrid**
- KPI cards (revenue, orders, AOV, conversion rate)
- Comparison indicators (green/red)
- Loading skeletons

**ChartsSection**
- SalesTrendChart (line chart)
- CategoryPerformanceChart (pie chart)
- CustomerAcquisitionChart (line chart)
- AOVTrendChart (line chart)
- ConversionRateChart (line chart)

**ReportsSection**
- InventoryTable
- SalesTable with export button
- ProductPerformanceTable

**RealtimeSection**
- TodayMetricsCard
- ActiveUsersCard
- RecentOrdersFeed
- RevenueGoalProgress

## Data Models

### Aggregation Pipeline Structures

**Sales Trends Aggregation**
```typescript
// Pipeline for daily sales trends
[
  {
    $match: {
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'shipped', 'delivered'] }
    }
  },
  {
    $group: {
      _id: {
        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
      },
      revenue: { $sum: '$totalAmount' },
      orderCount: { $sum: 1 }
    }
  },
  {
    $sort: { _id: 1 }
  },
  {
    $project: {
      date: '$_id',
      revenue: 1,
      orderCount: 1,
      _id: 0
    }
  }
]
```

**Category Performance Aggregation**
```typescript
[
  {
    $match: {
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'shipped', 'delivered'] }
    }
  },
  {
    $unwind: '$items'
  },
  {
    $lookup: {
      from: 'products',
      localField: 'items.productId',
      foreignField: '_id',
      as: 'product'
    }
  },
  {
    $unwind: '$product'
  },
  {
    $lookup: {
      from: 'categories',
      localField: 'product.categoryId',
      foreignField: '_id',
      as: 'category'
    }
  },
  {
    $unwind: '$category'
  },
  {
    $group: {
      _id: '$category._id',
      categoryName: { $first: '$category.name' },
      revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
      orderCount: { $sum: 1 }
    }
  },
  {
    $sort: { revenue: -1 }
  }
]
```

**Customer Metrics Aggregation**
```typescript
// New customers in period
[
  {
    $match: {
      createdAt: { $gte: startDate, $lte: endDate }
    }
  },
  {
    $count: 'newCustomers'
  }
]

// Repeat customer rate
[
  {
    $match: {
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'shipped', 'delivered'] }
    }
  },
  {
    $group: {
      _id: '$userId',
      orderCount: { $sum: 1 }
    }
  },
  {
    $group: {
      _id: null,
      totalCustomers: { $sum: 1 },
      repeatCustomers: {
        $sum: { $cond: [{ $gt: ['$orderCount', 1] }, 1, 0] }
      }
    }
  },
  {
    $project: {
      repeatCustomerRate: {
        $multiply: [
          { $divide: ['$repeatCustomers', '$totalCustomers'] },
          100
        ]
      }
    }
  }
]

// Churn rate (customers with no orders in last 90 days)
[
  {
    $match: {
      createdAt: { $lt: ninetyDaysAgo }
    }
  },
  {
    $group: {
      _id: '$userId',
      lastOrderDate: { $max: '$createdAt' }
    }
  },
  {
    $match: {
      lastOrderDate: { $lt: ninetyDaysAgo }
    }
  },
  {
    $count: 'churnedCustomers'
  }
]
```

**AOV Calculation Aggregation**
```typescript
[
  {
    $match: {
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: ['completed', 'shipped', 'delivered'] }
    }
  },
  {
    $group: {
      _id: null,
      totalRevenue: { $sum: '$totalAmount' },
      orderCount: { $sum: 1 }
    }
  },
  {
    $project: {
      aov: { $divide: ['$totalRevenue', '$orderCount'] }
    }
  }
]
```

**Inventory Status Aggregation**
```typescript
[
  {
    $lookup: {
      from: 'categories',
      localField: 'categoryId',
      foreignField: '_id',
      as: 'category'
    }
  },
  {
    $unwind: '$category'
  },
  {
    $addFields: {
      status: {
        $switch: {
          branches: [
            { case: { $eq: ['$stock', 0] }, then: 'out' },
            { case: { $lt: ['$stock', 10] }, then: 'low' },
            { case: { $gt: ['$stock', 100] }, then: 'overstocked' }
          ],
          default: 'normal'
        }
      }
    }
  },
  {
    $match: {
      status: { $in: [requestedStatus] } // or all statuses
    }
  },
  {
    $project: {
      productId: '$_id',
      productName: '$name',
      categoryName: '$category.name',
      stock: 1,
      status: 1
    }
  },
  {
    $skip: (page - 1) * limit
  },
  {
    $limit: limit
  }
]
```

### Cache Key Patterns

```typescript
const CACHE_KEYS = {
  TODAY_METRICS: 'analytics:today-metrics',
  SALES_TRENDS: (start: string, end: string, granularity: string, categoryId?: string) =>
    `analytics:sales-trends:${start}:${end}:${granularity}${categoryId ? `:${categoryId}` : ''}`,
  CATEGORY_PERFORMANCE: (start: string, end: string) =>
    `analytics:category-performance:${start}:${end}`,
  CUSTOMER_METRICS: (start: string, end: string) =>
    `analytics:customer-metrics:${start}:${end}`,
  AOV_METRICS: (start: string, end: string) =>
    `analytics:aov-metrics:${start}:${end}`,
  RECENT_ORDERS: (limit: number) =>
    `analytics:recent-orders:${limit}`,
  REVENUE_GOAL: (period: string) =>
    `analytics:revenue-goal:${period}`
};

const CACHE_TTL = {
  TODAY_METRICS: 300, // 5 minutes
  SALES_TRENDS: 1800, // 30 minutes
  CATEGORY_PERFORMANCE: 1800, // 30 minutes
  CUSTOMER_METRICS: 3600, // 1 hour
  AOV_METRICS: 1800, // 30 minutes
  RECENT_ORDERS: 60, // 1 minute
  REVENUE_GOAL: 300 // 5 minutes
};
```

### Database Indexes

Required indexes for optimal query performance:

```typescript
// Orders collection
db.orders.createIndex({ createdAt: 1, status: 1 });
db.orders.createIndex({ userId: 1, createdAt: -1 });
db.orders.createIndex({ status: 1, createdAt: -1 });

// Products collection
db.products.createIndex({ categoryId: 1 });
db.products.createIndex({ stock: 1 });

// Users collection
db.users.createIndex({ createdAt: 1 });
db.users.createIndex({ lastLoginAt: -1 });
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Core Data Properties

**Property 1: Sales trends data completeness**
*For any* valid date range and granularity, the sales trends API response should contain a data point for each period within the range, with each point having a date, revenue, and orderCount field.
**Validates: Requirements 1.1, 1.3**

**Property 2: Category performance completeness**
*For any* date range, the category performance API response should include all categories (even those with zero sales), with each category having categoryId, categoryName, revenue, percentage, and orderCount fields.
**Validates: Requirements 2.1, 2.2, 2.5**

**Property 3: Category sorting invariant**
*For any* category performance result, the categories should be sorted by revenue in descending order (highest revenue first).
**Validates: Requirements 2.4**

**Property 4: Customer metrics data structure**
*For any* date range, the customer metrics API response should include newCustomers count, repeatCustomerRate, churnRate, acquisitionTrend array, and previousPeriod comparison data.
**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

**Property 5: AOV calculation correctness**
*For any* date range with completed orders, the average order value should equal the total revenue divided by the order count, and the response should include currentAOV, previousAOV, percentageChange, and trend data.
**Validates: Requirements 4.1, 4.2, 4.5**

**Property 6: Conversion rate calculation**
*For any* date range with visitor data, the conversion rate should equal (completed orders / unique visitors) * 100, formatted to exactly 2 decimal places.
**Validates: Requirements 5.1, 5.2, 5.3, 5.5**

**Property 7: Inventory status classification**
*For any* product, its inventory status should be classified as: 'out' if stock = 0, 'low' if 0 < stock < 10, 'overstocked' if stock > 100, otherwise 'normal'.
**Validates: Requirements 6.1, 6.2, 6.3**

**Property 8: Inventory report data structure**
*For any* inventory report result, each product should include productId, productName, categoryName, stock, and status fields.
**Validates: Requirements 6.4**

**Property 9: Sales report data completeness**
*For any* date range, each sales report record should include orderDate, orderId, customerName, totalAmount, and status fields.
**Validates: Requirements 7.1**

**Property 10: CSV export completeness**
*For any* sales report data, the CSV export should include all records without pagination, with column headers in the first row.
**Validates: Requirements 7.2, 7.3, 7.5**

**Property 11: Product performance ranking**
*For any* product performance query, products should be ranked by total revenue, with best sellers sorted descending and worst sellers sorted ascending, limited to the specified number of results.
**Validates: Requirements 8.1, 8.2, 8.3, 8.5**

**Property 12: Today's metrics calculation**
*For any* point in time, today's metrics should include revenue (sum of completed orders today), orderCount (count of orders today), activeUsers (users logged in within 24 hours), and percentage changes compared to yesterday.
**Validates: Requirements 9.1, 9.2, 9.5**

**Property 13: Recent orders limit and ordering**
*For any* recent orders query, the result should contain at most the specified limit of orders, sorted by createdAt in descending order (most recent first), with each order including orderId, customerName, totalAmount, status, createdAt, and relativeTime.
**Validates: Requirements 10.2, 10.3, 10.4, 10.5**

**Property 14: Active users counting**
*For any* point in time, the active users count should equal the number of users with lastLoginAt within the last 24 hours.
**Validates: Requirements 10.1**

**Property 15: Revenue goal progress calculation**
*For any* revenue goal data, the progress percentage should equal (currentRevenue / goalAmount) * 100, capped at 100% with an overflow indicator when exceeded, and should include both absolute values and percentage.
**Validates: Requirements 11.1, 11.2, 11.3**

### Filter and Query Properties

**Property 16: Date range validation**
*For any* API request with date range parameters, if the end date is before the start date, the API should return a 400 error with a descriptive message.
**Validates: Requirements 12.6, 23.1**

**Property 17: Date range preset calculations**
*For any* preset date range selection ("Today", "Last 7 days", "Last 30 days"), the calculated date range should span exactly the specified period using UTC timezone.
**Validates: Requirements 12.1, 12.2, 12.3, 23.5**

**Property 18: Date range limits**
*For any* date range spanning more than 365 days, the API should return a 400 error indicating the range is too large.
**Validates: Requirements 23.4**

**Property 19: Default date range**
*For any* API request missing date range parameters, the system should default to the last 30 days.
**Validates: Requirements 23.2**

**Property 20: Invalid date handling**
*For any* API request with invalid date parameters (non-ISO format, invalid dates), the API should return a 400 error with a descriptive message.
**Validates: Requirements 23.3**

**Property 21: Category filtering**
*For any* query with a category filter applied, all returned products should belong to the specified category.
**Validates: Requirements 13.1**

**Property 22: Status filtering**
*For any* query with an order status filter applied, all returned orders should have the specified status.
**Validates: Requirements 13.2**

**Property 23: Multiple filter combination**
*For any* query with multiple filters applied (category AND status), all returned results should satisfy all filter conditions simultaneously.
**Validates: Requirements 13.3**

**Property 24: Filter clearing**
*For any* query with all filters cleared, the result count should equal the unfiltered count for the selected date range.
**Validates: Requirements 13.4**

**Property 25: Period comparison date calculation**
*For any* period comparison (e.g., "This month vs Last month"), both date ranges should be complete calendar periods of equal length, and the percentage change should be calculated as ((current - previous) / previous) * 100.
**Validates: Requirements 14.1, 14.2**

### UI Rendering Properties

**Property 26: Comparison color coding**
*For any* metric comparison where current value differs from previous value, the UI should display green color coding when current > previous, and red color coding when current < previous.
**Validates: Requirements 1.4, 1.5, 4.3, 4.4, 9.3, 9.4, 14.5, 14.6, 15.5**

**Property 27: Interactive tooltips**
*For any* chart data point or pie chart segment, hovering should display a tooltip containing detailed information (exact values, dates, percentages as applicable).
**Validates: Requirements 1.6, 15.3, 22.3**

**Property 28: Small category grouping**
*For any* revenue breakdown by category, categories contributing less than 2% of total revenue should be grouped into an "Other" category.
**Validates: Requirements 22.2**

**Property 29: Distinct category colors**
*For any* revenue breakdown visualization, each category should be assigned a distinct color for visual differentiation.
**Validates: Requirements 22.4**

### Pagination Properties

**Property 30: Pagination trigger**
*For any* report with more than 50 records, the response should include pagination metadata (currentPage, totalPages, totalItems) and pagination controls should be displayed.
**Validates: Requirements 18.1, 18.5**

**Property 31: Page data isolation**
*For any* paginated query with page number N and limit L, the response should contain exactly L records (or fewer on the last page), starting at offset (N-1) * L.
**Validates: Requirements 18.2**

**Property 32: Pagination button states**
*For any* paginated view, the "Previous" button should be disabled when currentPage = 1, and the "Next" button should be disabled when currentPage = totalPages.
**Validates: Requirements 18.3, 18.4**

### Caching Properties

**Property 33: Cache TTL enforcement**
*For any* cached metric, if a request is made within the TTL period, the cached data should be returned; if the request is made after TTL expiration, fresh data should be fetched and cached.
**Validates: Requirements 17.1, 17.3**

**Property 34: Cache invalidation on data change**
*For any* order creation or update event, all cached metrics that depend on order data should be invalidated, and the next request should fetch fresh data.
**Validates: Requirements 17.4, 17.5**

**Property 35: Inventory status update reflection**
*For any* product stock change, the next inventory report request should reflect the updated stock value and recalculated status.
**Validates: Requirements 6.5**

### CSV Export Properties

**Property 36: CSV field escaping**
*For any* CSV export, fields containing commas should be wrapped in double quotes, and fields containing double quotes should have those quotes escaped with double quotes.
**Validates: Requirements 21.2, 21.3**

**Property 37: CSV special character encoding**
*For any* CSV export containing special characters (newlines, unicode, etc.), those characters should be properly encoded to maintain data integrity.
**Validates: Requirements 21.1**

**Property 38: CSV filename format**
*For any* CSV export, the filename should follow the pattern "{report-type}-{startDate}-{endDate}.csv" and the Content-Type header should be "text/csv".
**Validates: Requirements 21.4, 21.5**

### Formatting Properties

**Property 39: Monetary value formatting**
*For any* monetary value displayed, it should be formatted as: USD symbol ($), two decimal places, thousand separators for values >= 1000, and for negative values the minus sign should precede the dollar symbol (e.g., "-$1,234.56").
**Validates: Requirements 24.1, 24.2, 24.3, 24.5**

**Property 40: Relative time formatting**
*For any* timestamp displayed in recent activity, it should be formatted as relative time (e.g., "5 minutes ago", "2 hours ago", "3 days ago").
**Validates: Requirements 10.5**

### UI State Properties

**Property 41: Loading state indicators**
*For any* data fetch in progress, the UI should display loading indicators (skeletons or spinners) for the affected sections.
**Validates: Requirements 19.3, 20.1**

**Property 42: Error state display**
*For any* failed data fetch, the UI should display an error message with the failure reason and a retry button.
**Validates: Requirements 19.4, 20.2, 20.3**

**Property 43: State transition on retry**
*For any* retry action after an error, the previous error message should be cleared and a loading state should be displayed.
**Validates: Requirements 20.4**

**Property 44: Successful load state**
*For any* successful data fetch, all loading indicators should be removed and the data should be displayed.
**Validates: Requirements 19.5, 20.5**

## Error Handling

### API Error Responses

All API endpoints follow a consistent error response format:

```typescript
{
  error: {
    code: string;
    message: string;
    details?: any;
  }
}
```

### Error Scenarios

**400 Bad Request**
- Invalid date range (end before start)
- Date range too large (> 1 year)
- Invalid date format
- Invalid query parameters
- Missing required parameters

**404 Not Found**
- Revenue goal not configured
- Category not found
- Product not found

**500 Internal Server Error**
- Database connection failure
- Aggregation pipeline error
- Cache service failure

### Frontend Error Handling

**Network Errors**
- Display user-friendly message: "Unable to connect to server. Please check your connection."
- Provide retry button
- Log error details to console

**Validation Errors**
- Display specific validation message from API
- Highlight invalid form fields
- Prevent form submission until corrected

**Data Loading Errors**
- Display error message in affected component
- Keep other components functional
- Provide retry option for failed component

**Empty Data States**
- Display helpful message: "No data available for the selected period"
- Suggest adjusting filters or date range
- Show empty state illustration

## Testing Strategy

### Dual Testing Approach

The Enhanced Admin Dashboard requires both **unit testing** and **property-based testing** for comprehensive coverage:

**Unit Tests** focus on:
- Specific examples demonstrating correct behavior
- Edge cases (empty data, zero values, missing goals)
- Error conditions (invalid dates, network failures)
- Integration points between components
- UI component rendering with specific props

**Property-Based Tests** focus on:
- Universal properties that hold for all inputs
- Data structure invariants across random inputs
- Calculation correctness across value ranges
- Filtering and sorting behavior with random data
- Format consistency across all possible values

### Property-Based Testing Configuration

**Library Selection**: Use **fast-check** for TypeScript/JavaScript property-based testing

**Test Configuration**:
- Minimum 100 iterations per property test
- Each test tagged with: `Feature: enhanced-admin-dashboard, Property {N}: {property_text}`
- Custom generators for domain objects (dates, orders, products, users)

**Example Property Test Structure**:
```typescript
import fc from 'fast-check';

// Feature: enhanced-admin-dashboard, Property 3: Category sorting invariant
describe('Category Performance', () => {
  it('should sort categories by revenue in descending order', () => {
    fc.assert(
      fc.property(
        fc.array(categoryGenerator(), { minLength: 1, maxLength: 20 }),
        fc.date(),
        fc.date(),
        async (categories, startDate, endDate) => {
          // Setup: seed database with categories and orders
          // Execute: call getCategoryPerformance API
          // Assert: verify result is sorted by revenue descending
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Test Coverage Requirements

**Backend Services** (Target: 90% coverage)
- All aggregation pipeline logic
- Cache service operations
- Date range calculations
- Filter combinations
- CSV generation

**API Endpoints** (Target: 85% coverage)
- Request validation
- Query parameter handling
- Response formatting
- Error handling

**Frontend Components** (Target: 80% coverage)
- Chart rendering with various data shapes
- Filter interactions
- Loading and error states
- Responsive layout behavior

### Integration Testing

**API Integration Tests**:
- Test complete request/response cycles
- Verify database queries execute correctly
- Test cache behavior across requests
- Validate CSV download functionality

**End-to-End Tests** (using Playwright or Cypress):
- User selects date range → all charts update
- User applies filters → data is filtered correctly
- User exports CSV → file downloads with correct data
- User navigates pages → pagination works correctly

### Performance Testing

**Load Testing**:
- Simulate 100 concurrent users accessing dashboard
- Measure response times for all endpoints
- Verify cache effectiveness under load
- Test with large datasets (100k+ orders)

**Query Performance**:
- Verify aggregation queries complete within 2 seconds
- Test with date ranges up to 1 year
- Monitor database index usage
- Profile slow queries and optimize

### Test Data Generators

**Custom Generators for Property Tests**:

```typescript
// Date range generator (valid ranges only)
const dateRangeGenerator = () =>
  fc.tuple(fc.date(), fc.date())
    .filter(([start, end]) => start <= end)
    .map(([start, end]) => ({
      startDate: start.toISOString(),
      endDate: end.toISOString()
    }));

// Order generator
const orderGenerator = () =>
  fc.record({
    userId: fc.uuid(),
    items: fc.array(orderItemGenerator(), { minLength: 1 }),
    totalAmount: fc.double({ min: 0.01, max: 10000 }),
    status: fc.constantFrom('pending', 'completed', 'shipped', 'delivered', 'cancelled'),
    createdAt: fc.date()
  });

// Product generator
const productGenerator = () =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 100 }),
    categoryId: fc.uuid(),
    stock: fc.integer({ min: 0, max: 200 }),
    price: fc.double({ min: 0.01, max: 1000 })
  });

// Category generator
const categoryGenerator = () =>
  fc.record({
    name: fc.string({ minLength: 1, maxLength: 50 }),
    description: fc.string()
  });
```

### Mocking Strategy

**Backend Tests**:
- Mock MongoDB connection for unit tests
- Use in-memory MongoDB for integration tests
- Mock cache service for service layer tests
- Mock external APIs (if any)

**Frontend Tests**:
- Mock API calls using MSW (Mock Service Worker)
- Mock Recharts components for unit tests
- Use real Recharts for integration tests
- Mock date/time for consistent test results

## Implementation Notes

### Technology Stack

**Backend**:
- Node.js 18+
- Express 4.x
- TypeScript 5.x
- MongoDB 6.x with Mongoose
- Node-cache for in-memory caching
- csv-stringify for CSV generation

**Frontend**:
- React 18+
- TypeScript 5.x
- Recharts 2.x for charts
- date-fns for date manipulation
- Axios for API calls
- React Query for data fetching and caching

**Testing**:
- Jest for unit testing
- fast-check for property-based testing
- Supertest for API testing
- React Testing Library for component testing
- Playwright for E2E testing

### Performance Optimizations

**Database**:
- Create compound indexes on frequently queried fields
- Use aggregation pipeline stages efficiently
- Limit result sets with $limit and $skip
- Use $project to return only needed fields

**Caching Strategy**:
- Cache today's metrics for 5 minutes
- Cache historical metrics for 30 minutes
- Invalidate cache on order mutations
- Use cache keys with filter parameters

**Frontend**:
- Lazy load chart components
- Debounce filter changes (300ms)
- Use React.memo for expensive components
- Implement virtual scrolling for large tables
- Code-split dashboard sections

### Security Considerations

**Authentication**:
- All endpoints require admin authentication
- Verify JWT token on every request
- Check user role is 'admin'

**Input Validation**:
- Validate all date parameters
- Sanitize query parameters
- Limit date range to prevent abuse
- Validate pagination parameters

**Data Access**:
- Only return aggregated data (no PII in analytics)
- Mask sensitive customer information
- Implement rate limiting on export endpoints
- Log all admin actions for audit trail

### Deployment Considerations

**Environment Variables**:
```
CACHE_TTL_TODAY_METRICS=300
CACHE_TTL_ANALYTICS=1800
MAX_DATE_RANGE_DAYS=365
DEFAULT_DATE_RANGE_DAYS=30
EXPORT_MAX_RECORDS=10000
```

**Database Migration**:
- Create indexes before deploying
- Test aggregation queries on production-like data
- Monitor query performance after deployment

**Monitoring**:
- Track API response times
- Monitor cache hit rates
- Alert on slow queries (> 2 seconds)
- Track error rates by endpoint
