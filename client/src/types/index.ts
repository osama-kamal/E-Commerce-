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
export type PaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded';
export type PaymentMethod = 'online' | 'cod';

// ── Refunds ───────────────────────────────────────────────────────────────────

export interface RefundLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  subtotalRefunded: number;
  taxRefunded: number;
  restocked: boolean;
}

export interface Refund {
  _id: string;
  orderId: string;
  lines: RefundLine[];
  subtotalRefunded: number;
  taxRefunded: number;
  shippingRefunded: number;
  totalRefunded: number;
  currency: string;
  reason?: string;
  status: 'pending' | 'succeeded' | 'failed';
  provider: 'stripe' | 'paymob' | 'manual';
  failureReason?: string;
  /** True when the refund was made in the provider's dashboard, not here. */
  outOfBand: boolean;
  createdAt: string;
}

/**
 * What a refund WOULD return, computed server-side.
 *
 * The client never derives these. Proration of discount and tax across lines is
 * subtle enough that a second implementation would drift, and this one decides
 * how much of a customer's money moves.
 */
export interface RefundPreview {
  lines: Array<{
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotalRefunded: number;
    taxRefunded: number;
  }>;
  subtotalRefunded: number;
  taxRefunded: number;
  shippingRefunded: number;
  totalRefunded: number;
  taxInclusive: boolean;
  remainingRefundable: number;
  currency: string;
}

/** One jurisdiction's tax on an order, as itemised on the invoice. */
export interface OrderTaxLine {
  name: string;
  rate: number;
  amount: number;
  /** True when the amount was contained in the price rather than added to it. */
  inclusive: boolean;
}

export interface OrderShippingMethod {
  rateId?: string;
  name: string;
  amount: number;
}

export interface Order {
  _id: string;
  customerId: string;
  items: OrderItem[];
  /**
   * The amount CHARGED — grand total including shipping and, when the store
   * prices tax-exclusively, tax. Render this as "Total"; use the breakdown
   * fields below for the lines above it.
   */
  totalAmount: number;
  /** Σ(line price × qty) before discount, shipping or tax. Optional on legacy orders. */
  subtotal?: number;
  discountAmount?: number;
  shippingTotal?: number;
  /**
   * Tax added (exclusive pricing) or contained (inclusive pricing).
   * Check `taxLines[].inclusive` before labelling it — an inclusive amount must
   * be shown as "includes X VAT", never added to the displayed total.
   */
  taxTotal?: number;
  taxLines?: OrderTaxLine[];
  shippingMethod?: OrderShippingMethod;
  currency?: string;
  couponCode?: string;
  /** FULFILMENT state — where the goods are. Says nothing about money. */
  status: OrderStatus;
  /**
   * PAYMENT state — where the money is. Orthogonal to `status`, so a delivered
   * order can also be refunded. Optional on orders written before refunds
   * existed; `migrate:payment-status` backfills them.
   */
  paymentStatus?: PaymentStatus;
  /** Running total refunded, in the order's currency. */
  refundedTotal?: number;
  paymentMethod: PaymentMethod;
  paymentIntentId?: string;
  shippingAddress: ShippingAddress;
  createdAt: string;
  updatedAt: string;
}

// ── Shipping & tax configuration (merchant admin) ────────────────────────────

export type ShippingRateType = 'flat' | 'free_over' | 'price_tier';

export interface ShippingTier {
  minSubtotal: number;
  maxSubtotal: number | null;
  amount: number;
}

export interface ShippingZone {
  _id: string;
  name: string;
  /** ISO-2 codes, uppercase. `['*']` means rest of world. */
  countries: string[];
  isActive: boolean;
  sortOrder: number;
}

export interface ShippingRate {
  _id: string;
  zoneId: string;
  name: string;
  description?: string;
  type: ShippingRateType;
  flatAmount: number;
  freeOverThreshold?: number | null;
  tiers: ShippingTier[];
  isActive: boolean;
  sortOrder: number;
}

export interface TaxRate {
  _id: string;
  name: string;
  rate: number;
  country: string;
  state?: string | null;
  appliesToShipping: boolean;
  isActive: boolean;
}

/** A priced delivery option returned by POST /shipping/quote. */
export interface ShippingOption {
  rateId: string;
  name: string;
  description?: string;
  amount: number;
}

/** Server-computed money breakdown. Never recompute these on the client. */
export interface OrderTotals {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  taxLines: OrderTaxLine[];
}

export interface ShippingQuote {
  subtotal: number;
  options: ShippingOption[];
  /** Which option `totals` was priced against. */
  selectedRateId: string | null;
  /**
   * Totals from the SAME engine that will price the real order, so what the
   * shopper is quoted is what they are charged. Render these directly rather
   * than deriving totals in the component.
   */
  totals: OrderTotals;
  /** False means the store does not deliver to the requested destination. */
  shipsToDestination: boolean;
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

/** One currency's slice of revenue. Never sum these — see `revenueByCurrency`. */
export interface RevenueByCurrency {
  currency: string;
  /** Net: charged, minus tax, minus refunds. */
  revenue: number;
  grossCharged: number;
  taxCollected: number;
  refunded: number;
  orderCount: number;
}

export interface DashboardStats {
  /**
   * Net revenue in the store's own currency: charged − tax − refunds, counted
   * once an order is PAID (so cash-on-delivery counts on payment, not on
   * placement).
   */
  totalRevenue: number;
  /** ISO code `totalRevenue` is expressed in. */
  currency?: string;
  /**
   * Per-currency breakdown. More than one row means the store has orders in
   * several currencies — display them separately, never added together.
   */
  revenueByCurrency?: RevenueByCurrency[];
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
   * Whether catalogue prices already contain tax.
   *
   * `false` (US style) — tax is added at checkout, so the customer pays more
   * than the listed price. `true` (EU/UK/MENA style) — the listed price already
   * contains tax and the invoice breaks it out.
   *
   * Presentation must respect this: an inclusive tax amount is annotated
   * ("includes £16.67 VAT"), never added to the displayed total.
   */
  pricesIncludeTax?: boolean;
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
  /**
   * Server-resolved entitlement and access level. This is authoritative — the
   * client must not recompute trial state from `createdAt` (it used to, which
   * is why the paywall existed only in the browser and every API endpoint
   * stayed open to an expired trial).
   *
   * Optional because it is absent on older API responses and on the brief
   * window before the store loads. Treat a missing value as UNRESTRICTED: a
   * failed store fetch must never lock a merchant out of their own dashboard.
   */
  subscription?: {
    level: 'full' | 'restricted';
    reason: 'active' | 'trialing' | 'grace_period' | 'pending_upgrade' | 'free_tier' | 'suspended';
    /** The plan whose limits actually apply — not necessarily what was purchased. */
    effectivePlan: string;
    isTrialing: boolean;
    trialEndsAt: string | null;
    trialDaysRemaining: number | null;
  };
  customDomain?: string;
  isActive: boolean;
  settings: StoreSettings;
  createdAt: string;
  updatedAt: string;
}
