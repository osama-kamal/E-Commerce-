import mongoose, { Document, Schema, Types } from 'mongoose';

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
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

export interface IOrder extends Document {
  storeId: Types.ObjectId;
  customerId: Types.ObjectId;
  items: IOrderItem[];
  totalAmount: number;
  currency: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentIntentId?: string;
  discountAmount: number;
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
