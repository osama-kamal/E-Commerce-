import mongoose, { Document, Schema, Types } from 'mongoose';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed';
export type PaymentProviderName = 'stripe' | 'paymob';

export interface IPayment extends Document {
  orderId: Types.ObjectId;
  customerId: Types.ObjectId;
  stripePaymentIntentId: string;  // pi_xxx — Stripe reference only, never card data
  /**
   * Which gateway took this payment.
   *
   * The collection was Stripe-shaped despite the provider abstraction, and the
   * Paymob adapter worked around it by writing `paymob_<transId>` into
   * `stripePaymentIntentId`. That encoding is fine for storage but useless for
   * REFUNDS, which have to know which gateway to call and need the raw
   * reference to call it with. Both are now explicit.
   *
   * Optional on rows written before this field existed — `resolveProviderRef`
   * in the refund service recovers them from the prefixed legacy value.
   */
  provider?: PaymentProviderName;
  /** The gateway's own reference, unprefixed: `pi_xxx`, or a Paymob transaction id. */
  providerPaymentId?: string;
  amount: number;                 // in smallest currency unit (cents)
  currency: string;
  status: PaymentStatus;
  stripeEventId: string;          // for idempotency — deduplicate webhook events
  createdAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // NOT unique. Stripe reuses one PaymentIntent across card retries, so a single
    // intent legitimately produces several events (payment_failed then succeeded).
    // A unique constraint here made the success write fail with E11000 after any
    // earlier failure — the customer was charged and the order stayed 'pending'.
    // Idempotency is enforced by the unique `stripeEventId` below, which is the
    // correct key: one row per Stripe event, not per intent.
    stripePaymentIntentId: { type: String, required: true, index: true },
    provider: { type: String, enum: ['stripe', 'paymob'], default: 'stripe' },
    providerPaymentId: { type: String, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'usd' },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed'],
      required: true,
      default: 'pending',
    },
    stripeEventId: { type: String, required: true, unique: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
