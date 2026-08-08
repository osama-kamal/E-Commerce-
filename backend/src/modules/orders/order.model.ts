import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * FULFILMENT state — where the goods are.
 *
 * Deliberately says nothing about money. Payment lives on its own axis
 * (`PaymentStatus`) because the two are genuinely independent: a delivered
 * order can be fully refunded, an unshipped one can be paid, and a cash-on-
 * delivery order is unpaid for its entire fulfilment life.
 *
 * Adding `refunded` here instead would have made "delivered AND refunded" —
 * the normal shape of a return — inexpressible.
 */
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

/** PAYMENT state — where the money is. Orthogonal to fulfilment. */
export type PaymentStatus = 'unpaid' | 'paid' | 'partially_refunded' | 'refunded';

export type PaymentMethod = 'online' | 'cod';

export interface IOrderItem {
  productId: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  selectedSize?: string;
}

export interface IShippingAddress {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/** One jurisdiction's tax on this order, retained so an invoice can itemise it. */
export interface IOrderTaxLine {
  name: string;
  rate: number;
  amount: number;
  /** True when the amount was extracted from the price rather than added to it. */
  inclusive: boolean;
  /**
   * Whether this rate also covered the shipping charge.
   *
   * Persisted so a REFUND can split the tax correctly. Refunding two of three
   * items must return the tax on those items but not the tax on delivery (which
   * the merchant still incurred), and that split is impossible to reconstruct
   * from `amount` alone. Absent on orders written before refunds existed —
   * treated as false, which matches the era when shipping was always zero.
   */
  appliesToShipping?: boolean;
}

/** Snapshot of the delivery option the customer chose. */
export interface IOrderShippingMethod {
  rateId?: Types.ObjectId;
  name: string;
  amount: number;
}

export interface IOrder extends Document {
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  items: IOrderItem[];
  /**
   * The amount actually charged — the grand total, inclusive of shipping and
   * (in exclusive mode) tax.
   *
   * Deliberately NOT renamed. Every payment path already charges this field
   * (`payment.service`, `paymob.adapter`), so keeping its meaning as "the sum
   * due" means the money model could be extended without touching a single
   * charge site. The breakdown below explains how it was reached.
   */
  totalAmount: number;
  /** Σ(line price × qty), before discount, shipping or tax. */
  subtotal: number;
  discountAmount: number;
  shippingTotal: number;
  /** Tax ADDED (exclusive) or CONTAINED (inclusive) — see taxLines[].inclusive. */
  taxTotal: number;
  taxLines: IOrderTaxLine[];
  shippingMethod?: IOrderShippingMethod;
  currency: string;
  /** Fulfilment state. See OrderStatus — says nothing about money. */
  status: OrderStatus;
  /** Payment state. Maintained by the payment webhooks and the refund service. */
  paymentStatus: PaymentStatus;
  /**
   * Running total refunded, in the order's currency.
   *
   * The ledger the refund service guards: every refund is reserved against this
   * with a conditional update, so concurrent refunds cannot together exceed
   * `totalAmount`.
   */
  refundedTotal: number;
  /**
   * The TAX portion of `refundedTotal`.
   *
   * Tracked separately because revenue is `(total − tax) − (refunded − refundedTax)`.
   * `refundedTotal` is gross — it contains the tax that went back with the
   * goods — so subtracting it from a figure that already excluded tax removes
   * the tax twice, and a fully-refunded order reports NEGATIVE revenue.
   */
  refundedTaxTotal: number;
  paymentMethod: PaymentMethod;
  paymentIntentId?: string;
  couponCode?: string;
  idempotencyKey?: string;
  shippingAddress: IShippingAddress;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    selectedSize: { type: String, default: null },
  },
  { _id: false }
);

const orderTaxLineSchema = new Schema<IOrderTaxLine>(
  {
    name: { type: String, required: true },
    rate: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    inclusive: { type: Boolean, required: true },
    appliesToShipping: { type: Boolean, default: false },
  },
  { _id: false }
);

const orderShippingMethodSchema = new Schema<IOrderShippingMethod>(
  {
    // Kept for traceability, but the NAME and AMOUNT are snapshotted so an
    // invoice stays truthful after the merchant renames or deletes the rate.
    rateId: { type: Schema.Types.ObjectId, ref: 'ShippingRate' },
    name: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shippingAddressSchema = new Schema<IShippingAddress>(
  {
    line1: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    postalCode: { type: String, required: true },
    country: { type: String, required: true },
  },
  { _id: false }
);

/**
 * Derives the payment state from the ledger.
 *
 * Single source of truth for the rule, so the refund service, the webhook
 * reconciler and the migration cannot disagree about when an order counts as
 * fully refunded. Uses a half-cent epsilon because `refundedTotal` accumulates
 * rounded per-refund amounts and a sequence of partial refunds can land a
 * fraction under the total.
 */
export function derivePaymentStatus(totalAmount: number, refundedTotal: number): PaymentStatus {
  if (refundedTotal <= 0) return 'paid';
  if (refundedTotal >= totalAmount - 0.005) return 'refunded';
  return 'partially_refunded';
}

// Valid status transitions — enforced in service layer
export const STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const orderSchema = new Schema<IOrder>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    totalAmount: { type: Number, required: true, min: 0 },
    // ── Money breakdown ──────────────────────────────────────────────────────
    // Defaults of 0 rather than `required` so orders written before shipping
    // and tax existed remain valid documents. `migrate:order-totals` backfills
    // `subtotal` on those; the two new totals are genuinely zero for them.
    subtotal: { type: Number, default: 0, min: 0 },
    shippingTotal: { type: Number, default: 0, min: 0 },
    taxTotal: { type: Number, default: 0, min: 0 },
    taxLines: { type: [orderTaxLineSchema], default: [] },
    shippingMethod: { type: orderShippingMethodSchema, default: undefined },
    // Snapshot of the store's currency at the time of purchase. Recorded on the
    // order (not read live from the store) so changing the store's currency
    // later cannot retroactively reinterpret historical amounts.
    currency: {
      type: String,
      required: true,
      default: 'USD',
      uppercase: true,
      match: [/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'],
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    // Defaults rather than `required` so orders written before refunds existed
    // remain valid documents; `migrate:payment-status` backfills them from the
    // Payment collection.
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partially_refunded', 'refunded'],
      default: 'unpaid',
      index: true,
    },
    refundedTotal: { type: Number, default: 0, min: 0 },
    refundedTaxTotal: { type: Number, default: 0, min: 0 },
    paymentIntentId: { type: String },
    paymentMethod: {
      type: String,
      enum: ['online', 'cod'],
      default: 'online',
      index: true,
    },
    discountAmount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String },
    // Idempotency key supplied by the client at checkout — prevents duplicate orders on retry.
    // No index options here: the compound partial index below is the only one needed.
    idempotencyKey: { type: String },
    shippingAddress: { type: shippingAddressSchema, required: true },
  },
  { timestamps: true }
);

// ── Compound indexes ───────────────────────────────────────────────────────────
// getMyOrders: customer's orders sorted by date — covers the most common query
orderSchema.index({ storeId: 1, customerId: 1, createdAt: -1 });
// getAllOrders (admin): store orders filtered by status, sorted by date
orderSchema.index({ storeId: 1, status: 1, createdAt: -1 });
// analytics: date-range aggregations across statuses
orderSchema.index({ storeId: 1, createdAt: -1 });
// Reservation-expiry job (expireStalePendingOrders) — deliberately NOT
// tenant-scoped: it sweeps abandoned online checkouts across every store, so it
// filters on { status, paymentMethod, createdAt } with no storeId. Without this
// it was a full collection scan every 5 minutes.
orderSchema.index({ status: 1, paymentMethod: 1, createdAt: 1 });
// Idempotency: unique per-store per-customer key.
//
// MUST use partialFilterExpression, NOT sparse. A compound sparse index includes
// a document when ANY indexed field is present, and storeId/customerId always
// are — so every order was indexed, key-less orders all indexed as
// `idempotencyKey: null`, and a customer could place only ONE order per store
// without a key. The second failed with E11000.
//
// The partial filter indexes only documents where idempotencyKey is an actual
// string, which is precisely the set the uniqueness constraint should cover.
orderSchema.index(
  { storeId: 1, customerId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);

export const Order = mongoose.model<IOrder>('Order', orderSchema);
