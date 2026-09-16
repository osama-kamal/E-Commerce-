import { Types } from 'mongoose';
import Stripe from 'stripe';
import { Order, derivePaymentStatus } from '../orders/order.model';
import { Payment } from '../payments/payment.model';
import { Refund } from './refund.model';
import { logger } from '../../utils/logger';
import { fromMinorUnits } from '../checkout/currency';

/**
 * Reconciles refunds reported by the payment provider.
 *
 * Two distinct cases arrive on the same `charge.refunded` event:
 *
 *   1. A refund THIS system issued. The local record already exists and is
 *      `pending` (Stripe settles some methods asynchronously); this confirms it.
 *
 *   2. A refund the merchant issued in the Stripe dashboard. Nothing local
 *      exists. Merchants do this constantly — it is the fastest path when a
 *      customer is on the phone — and without reconciliation the order would
 *      keep reporting the full amount as collected. The ledger would then
 *      disagree with the gateway, and the merchant could refund the same money
 *      a second time through this system because the balance still looked
 *      available.
 *
 * Case 2 is the reason this file exists. Recording it as `outOfBand` keeps the
 * order's `refundedTotal` honest without pretending we initiated it.
 */

// Minor → major units is scaled by the CHARGE's currency, taken from the Stripe
// event itself rather than assumed. Dividing by a hardcoded 100 read a ¥5,000
// refund as ¥50 and a KWD 5.000 refund as KWD 50 — the first silently
// under-reports the ledger (leaving money refundable that Stripe already
// returned, so it can go out twice), the second over-reports it.

export async function reconcileStripeRefund(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const paymentIntentId =
    typeof charge.payment_intent === 'string'
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (!paymentIntentId) {
    logger.warn('charge.refunded with no payment_intent — cannot reconcile', {
      eventId: event.id,
      chargeId: charge.id,
    });
    return;
  }

  // Stripe reports the CUMULATIVE amount refunded on the charge, not the delta
  // for this event. Comparing it against our running total is what makes this
  // handler idempotent under duplicate deliveries and safe when several refunds
  // land out of order.
  const chargeCurrency = (charge.currency ?? 'usd').toUpperCase();
  const providerRefundedTotal = fromMinorUnits(charge.amount_refunded ?? 0, chargeCurrency);

  const payment = await Payment.findOne({
    $or: [{ providerPaymentId: paymentIntentId }, { stripePaymentIntentId: paymentIntentId }],
    status: 'succeeded',
  }).lean();

  const orderId = payment?.orderId;
  if (!orderId) {
    logger.warn('charge.refunded for an unknown payment — nothing to reconcile', {
      eventId: event.id,
      paymentIntentId,
    });
    return;
  }

  const order = await Order.findById(orderId);
  if (!order) {
    logger.warn('charge.refunded for a missing order', { eventId: event.id, orderId });
    return;
  }

  const localTotal = order.refundedTotal ?? 0;
  const drift = Math.round((providerRefundedTotal - localTotal) * 100) / 100;

  // Confirm any of our own refunds still waiting on settlement.
  const settled = await Refund.updateMany(
    { orderId: order._id, status: 'pending', provider: 'stripe' },
    { $set: { status: 'succeeded' } }
  );
  if (settled.modifiedCount > 0) {
    logger.info('Confirmed pending refunds from charge.refunded', {
      orderId: order._id.toString(),
      confirmed: settled.modifiedCount,
    });
  }

  // Within a cent — the gateway and the ledger agree, nothing to record.
  if (Math.abs(drift) <= 0.005) return;

  if (drift < 0) {
    // The provider reports LESS refunded than we do. That means one of our
    // reservations is stuck: it was reserved but never actually executed, or a
    // release failed. Never silently reduce the ledger — a human should look,
    // because the safe direction is over-reporting.
    logger.error('Refund ledger exceeds the provider — possible stuck reservation', {
      orderId: order._id.toString(),
      localRefundedTotal: localTotal,
      providerRefundedTotal,
      eventId: event.id,
    });
    return;
  }

  // drift > 0: refunded at the provider but not here — an out-of-band refund.
  const newTotal = Math.min(
    Math.round((localTotal + drift) * 100) / 100,
    order.totalAmount
  );

  await Refund.create({
    storeId: order.storeId,
    orderId: order._id,
    customerId: order.customerId,
    lines: [],
    subtotalRefunded: drift,
    taxRefunded: 0,
    shippingRefunded: 0,
    totalRefunded: drift,
    currency: (order.currency ?? 'USD').toUpperCase(),
    reason: 'Refunded directly in the provider dashboard',
    status: 'succeeded',
    provider: 'stripe',
    providerRefundId: charge.id,
    // No line detail is recoverable — Stripe refunds an amount, not items. The
    // money is reconciled; stock is deliberately NOT restored, because nobody
    // told us which items (if any) came back.
    outOfBand: true,
  });

  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        refundedTotal: newTotal,
        paymentStatus: derivePaymentStatus(order.totalAmount, newTotal),
      },
    }
  );

  logger.warn('Recorded an out-of-band refund from the provider', {
    orderId: order._id.toString(),
    storeId: order.storeId.toString(),
    amount: drift,
    newRefundedTotal: newTotal,
    eventId: event.id,
  });
}

/** Narrow helper so callers do not need to import ObjectId here. */
export type OrderId = Types.ObjectId;
