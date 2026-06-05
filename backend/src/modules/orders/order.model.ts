import mongoose, { Document, Schema, Types } from 'mongoose';

export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

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
  status: OrderStatus;
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
    status: {
      type: String,
      enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
      index: true,
    },
    paymentIntentId: { type: String },
    discountAmount: { type: Number, default: 0, min: 0 },
    couponCode: { type: String },
    // Idempotency key supplied by the client at checkout — prevents duplicate orders on retry
    idempotencyKey: { type: String, sparse: true },
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
// Idempotency: unique per-store per-customer key — sparse so null values are excluded
orderSchema.index({ storeId: 1, customerId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

export const Order = mongoose.model<IOrder>('Order', orderSchema);
