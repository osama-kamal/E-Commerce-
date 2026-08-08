import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * A refund against an order.
 *
 * ── Why refunds are their own collection ──────────────────────────────────────
 * There was no reversal path at all: an admin's only option was to move the
 * order to `cancelled`, which restored stock and emailed the customer while
 * their money stayed taken. Chargebacks are how a payment processor terminates
 * a merchant account, so this is the record that keeps the ledger honest.
 *
 * Each row is an immutable financial event. Orders carry a running
 * `refundedTotal`; the truth of how that total was reached lives here, one
 * document per refund, with the line detail needed to answer "which item came
 * back and how much of the tax went with it".
 *
 * `provider: 'manual'` covers cash-on-delivery, where no gateway was ever
 * involved — the merchant hands cash back and this records that it happened.
 */

export type RefundStatus = 'pending' | 'succeeded' | 'failed';
export type RefundProvider = 'stripe' | 'paymob' | 'manual';

export interface IRefundLine {
  productId: Types.ObjectId;
  /** Snapshotted so the record stays readable if the product is renamed or deleted. */
  name: string;
  quantity: number;
  unitPrice: number;
  /** Proportional share of the discounted goods value. */
  subtotalRefunded: number;
  /** Proportional share of the tax assessed on goods. */
  taxRefunded: number;
  /** Whether these units went back into sellable inventory. */
  restocked: boolean;
}

export interface IRefund extends Document {
  storeId: Types.ObjectId;
  orderId: Types.ObjectId;
  customerId: Types.ObjectId;
  lines: IRefundLine[];
  subtotalRefunded: number;
  taxRefunded: number;
  shippingRefunded: number;
  /** What actually returned to the customer — the figure sent to the gateway. */
  totalRefunded: number;
  currency: string;
  reason?: string;
  note?: string;
  status: RefundStatus;
  provider: RefundProvider;
  /** The gateway's own refund reference (re_xxx, Paymob transaction id). */
  providerRefundId?: string;
  /** Failure detail, kept so a merchant can see why a refund did not go through. */
  failureReason?: string;
  /** Supplied by the caller; makes retrying a refund safe. Unique per store. */
  idempotencyKey?: string;
  /** Admin who issued it. Null for refunds reconciled from a provider webhook. */
  issuedBy?: Types.ObjectId;
  /** True when the refund was made outside this system and discovered by webhook. */
  outOfBand: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const refundLineSchema = new Schema<IRefundLine>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotalRefunded: { type: Number, required: true, min: 0 },
    taxRefunded: { type: Number, required: true, min: 0 },
    restocked: { type: Boolean, default: false },
  },
  { _id: false }
);

const refundSchema = new Schema<IRefund>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    lines: { type: [refundLineSchema], default: [] },
    subtotalRefunded: { type: Number, required: true, min: 0 },
    taxRefunded: { type: Number, required: true, min: 0 },
    shippingRefunded: { type: Number, required: true, min: 0 },
    totalRefunded: { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      match: [/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'],
    },
    reason: { type: String, trim: true, maxlength: 200 },
    note: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed'],
      default: 'pending',
      index: true,
    },
    provider: { type: String, enum: ['stripe', 'paymob', 'manual'], required: true },
    providerRefundId: { type: String, index: true },
    failureReason: { type: String },
    idempotencyKey: { type: String },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    outOfBand: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Refund history for an order, newest first.
refundSchema.index({ storeId: 1, orderId: 1, createdAt: -1 });

// Idempotency: one refund per key per store.
//
// partialFilterExpression, NOT sparse — the same hazard documented on the
// order's idempotency index. A compound sparse index includes a document when
// ANY indexed field is present, and storeId always is, so every refund would be
// indexed with `idempotencyKey: null` and the second key-less refund in a store
// would collide with E11000.
refundSchema.index(
  { storeId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

export const Refund = mongoose.model<IRefund>('Refund', refundSchema);
