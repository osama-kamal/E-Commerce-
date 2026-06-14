import mongoose, { Document, Schema } from 'mongoose';

/**
 * Records every Stripe webhook event that has been successfully processed.
 *
 * Purpose: idempotency guard.  Before processing any incoming event the
 * Webhook_Service queries this collection by `stripeEventId`.  If a document
 * already exists the event is a duplicate and processing is skipped.
 *
 * The unique index on `stripeEventId` acts as a second line of defence: even
 * if two concurrent deliveries both pass the `findOne` check, the DB will
 * reject the second `create()` with a duplicate-key error (code 11000) which
 * the outer handler treats as a no-op (not an error).
 *
 * This collection is intentionally separate from the `payments` collection,
 * which tracks order-level PaymentIntent events.  Subscription lifecycle events
 * are not order payments and should not be mixed with order payment records.
 */

export interface IStripeWebhookEvent extends Document {
  /** Stripe's own globally-unique event ID (evt_xxx). */
  stripeEventId: string;
  /** The event type string, e.g. 'customer.subscription.updated'. */
  type: string;
  /** Wall-clock time when this server finished processing the event. */
  processedAt: Date;
}

const stripeWebhookEventSchema = new Schema<IStripeWebhookEvent>(
  {
    stripeEventId: {
      type: String,
      required: true,
      unique: true,   // enforced at DB level — duplicate-key = race-condition guard
    },
    type: {
      type: String,
      required: true,
    },
    processedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  {
    // No updatedAt needed — this is an append-only audit log.
    timestamps: { createdAt: false, updatedAt: false },
  }
);

export const StripeWebhookEvent = mongoose.model<IStripeWebhookEvent>(
  'StripeWebhookEvent',
  stripeWebhookEventSchema
);
