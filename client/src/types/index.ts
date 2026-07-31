export interface User {
  _id: string;
  email: string;
  role: 'super-admin' | 'admin' | 'customer';
  isActive: boolean;
  createdAt: string;
}

export interface Category {
  _id: string;
  name: string;
  slug: string;
  parentId: string | null;
  level: number;
}

export interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  discount: number;
  originalPrice?: number;
  stock: number;
  categoryId: string;
  images: string[];
  sizes: string[];
  isDeleted: boolean;
  inStock: boolean;
  averageRating: number;
  reviewCount: number;
}

export interface CartItem {
  productId: string;
  name: string;
  currentPrice: number;
  quantity: number;
  lineTotal: number;
  selectedSize?: string;
}

export interface Cart {
  customerId: string;
  items: CartItem[];
  subtotal: number;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  selectedSize?: string;
}

export interface ShippingAddress {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
export type PaymentMethod = 'online' | 'cod';

export interface Order {
  _id: string;
  customerId: string;
  items: OrderItem[];
  totalAmount: number;
  discountAmount?: number;
  couponCode?: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentIntentId?: string;
  shippingAddress: ShippingAddress;
  createdAt: string;
  updatedAt: string;
}

export interface Review {
  _id: string;
  productId: string;
  customerId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface WishlistProduct {
  _id: string;
  name: string;
  price: number;
  images: string[];
  stock: number;
  averageRating: number;
}

export interface Wishlist {
  customerId: string;
  products: WishlistProduct[];
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  totalUsers: number;
  newCustomers: number;
  ordersByStatus: Record<string, number>;
  stockAlerts: { _id: string; name: string; stock: number }[];
}

export interface TopProduct {
  productId: string;
  name: string;
  unitsSold: number;
  revenue: number;
}

// Enhanced Admin Dashboard Types

export interface SalesTrendsResult {
  trends: Array<{
    date: string;
    revenue: number;
    orderCount: number;
  }>;
  previousPeriod: {
    revenue: number;
    orderCount: number;
    percentageChange: number | string;
  };
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
  acquisitionTrend: Array<{
    date: string;
    newCustomers: number;
  }>;
  previousPeriod: {
    newCustomers: number;
    percentageChange: number | string;
  };
}

export interface AOVMetricsResult {
  currentAOV: number;
  previousAOV: number;
  percentageChange: number | string;
  trend: Array<{
    date: string;
    aov: number;
  }>;
}

export interface ConversionMetricsResult {
  conversionRate: number;
  previousConversionRate: number;
  percentageChange: number | string;
  trend: Array<{
    date: string;
    conversionRate: number;
  }>;
}

export interface TodayMetricsResult {
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
    revenueChange: number | string;
    orderCountChange: number | string;
  };
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

export interface InventoryReportResult {
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

export interface SalesReportResult {
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

export interface ProductPerformanceResult {
  products: Array<{
    productId: string;
    productName: string;
    unitsSold: number;
    totalRevenue: number;
  }>;
  type: 'best' | 'worst';
}

// ── Store / Tenant ────────────────────────────────────────────────────────────

import type { StoreTheme } from '../theme/themes';
export type { StoreTheme };

export interface StoreSettings {
  logoUrl?: string;
  contactEmail?: string;
  contactPhone?: string;
  description?: string;
  facebook?: string;
  instagram?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
}

export interface Store {
  _id: string;
  name: string;
  slug: string;
  ownerId: string;
  subscriptionPlan: string;
  subscriptionStatus: string;
  requestedPlan?: string;
  /** ISO 4217 code the store prices and charges in (e.g. 'USD', 'EGP'). */
  currency?: string;
  /**
   * Storefront presentation theme. Optional because stores created before the
   * feature shipped have no value on disk — always read it through
   * `resolveTheme()` rather than using it directly.
   */
  theme?: StoreTheme;
  /**
   * Capabilities granted by the store's plan, derived server-side so the client
   * never mirrors the plan table. Absent on older API responses — treat a
   * missing value as "not granted".
   */
  planCapabilities?: {
    customDomain: boolean;
    removeBranding: boolean;
    apiAccess: boolean;
    maxProducts: number;
    maxOrdersPerMonth: number;
    maxStores: number;
  };
  customDomain?: string;
  isActive: boolean;
  settings: StoreSettings;
  createdAt: string;
  updatedAt: string;
}
