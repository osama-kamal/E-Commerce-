/**
 * StripeAdapter
 *
 * Implements `IPaymentProvider` by delegating to the existing, battle-tested
 * Stripe functions in `payment.service.ts` and `subscription.service.ts`.
 *
 * This file does NOT modify any existing code. It is a thin translation layer
 * that:
 *  1. Maps `InitiatePaymentParams` → `createPaymentIntent()` call
 *  2. Maps raw Stripe webhook → `stripe.webhooks.constructEvent()` + `ProviderEvent`
 *  3. Routes a `ProviderEvent` to the correct subscription/payment handler
 *
 * When `payment.service.ts` is eventually migrated to use this adapter,
 * the duplicate logic here will be removed and only this file will remain.
 * Until then, both paths coexist safely.
 */

import Stripe from 'stripe';
import { stripe } from '../../../config/stripe';
import { config } from '../../../config/index';
import { Order } from '../../orders/order.model';
import { Payment } from '../payment.model';
import { User } from '../../auth/user.model';
import { Types } from 'mongoose';
import { logger } from '../../../utils/logger';
import { minorUnitExponent } from '../../checkout/currency';
import { emailService } from '../../../services/email.service';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
} from '../subscription.service';
import type {
  IPaymentProvider,
  InitiatePaymentParams,
  InitiatePaymentResult,
  RefundPaymentParams,
  RefundPaymentResult,
  ProviderEvent,
  PaymentProviderKey,
} from './payment-provider.interface';

/**
 * Stripe's own constraint on three-decimal currencies (KWD, BHD, OMR, JOD, TND,
 * IQD, LYD): the amount must be submitted in the minor unit but be **evenly
 * divisible by 10**, because Stripe settles those currencies to two decimal
 * places. `toMinorUnits` produces the arithmetically correct figure; this
 * truncates it to something Stripe will actually accept.
 *
 * Truncates rather than rounds up, so the customer is never charged more than
 * the order says. The discarded remainder is at most one thousandth of a unit.
 *
 * Applied at the adapter boundary, not in `checkout/currency.ts` — this is a
 * quirk of one gateway, and baking it into the shared money helper would give
 * every other caller (Paymob, the ledger, reporting) a subtly wrong number.
 */
function toStripeAmount(amountInSmallestUnit: number, currency: string): number {
  if (minorUnitExponent(currency) !== 3) return amountInSmallestUnit;
  return Math.floor(amountInSmallestUnit / 10) * 10;
}

export class StripeAdapter implements IPaymentProvider {
  readonly name: PaymentProviderKey = 'stripe';

  // ── initiatePayment ──────────────────────────────────────────────────────

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const { orderId, customerId, storeId, amountInSmallestUnit, currency, idempotencyKey } = params;

    // Scope the order lookup to storeId + customerId to enforce cross-store isolation.
    const order = await Order.findOne({
      _id: orderId,
      customerId: new Types.ObjectId(customerId),
      storeId: new Types.ObjectId(storeId),
    }).lean();

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    if (order.status !== 'pending') {
      throw new Error(`Payment intent can only be created for pending orders (current: ${order.status})`);
    }

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: toStripeAmount(amountInSmallestUnit, currency),
        currency,
        metadata: { orderId, customerId },
      },
      {
        idempotencyKey: idempotencyKey ?? `order_intent_${orderId}`,
      }
    );

    // Attach the provider payment ID to the order for reconciliation.
    await Order.updateOne({ _id: orderId }, { paymentIntentId: paymentIntent.id });

    if (!paymentIntent.client_secret) {
      throw new Error('Stripe did not return a client_secret');
    }

    return {
      providerPaymentId: paymentIntent.id,
      clientData: {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      },
    };
  }

  // ── refundPayment ────────────────────────────────────────────────────────

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    const { providerPaymentId, amountInSmallestUnit, currency, idempotencyKey, reason } = params;

    // Amount is always supplied, even for a "full" refund. Omitting it lets
    // Stripe decide the figure, which would diverge from the ledger the caller
    // already reserved against — and on a partially-refunded intent Stripe's
    // idea of "full" is the remainder, not the original total.
    const refund = await stripe.refunds.create(
      {
        payment_intent: providerPaymentId,
        // Same three-decimal constraint as the charge — a refund Stripe rejects
        // for scale would strand the reservation the caller already made.
        amount: toStripeAmount(amountInSmallestUnit, currency),
        // Stripe accepts only a fixed vocabulary here, and a free-text merchant
        // reason is not part of it. The human reason is kept on our own Refund
        // record; this field is only for Stripe's fraud tooling.
        ...(reason === 'fraudulent' || reason === 'duplicate'
          ? { reason: reason as 'fraudulent' | 'duplicate' }
          : {}),
        metadata: { ...(reason ? { merchantReason: reason.slice(0, 500) } : {}) },
      },
      { idempotencyKey }
    );

    // Stripe reports `pending` for methods that settle asynchronously. The
    // caller must not treat that as failure — the money is on its way and
    // `charge.refunded` confirms it.
    return {
      providerRefundId: refund.id,
      status: refund.status === 'succeeded' ? 'succeeded' : 'pending',
    };
  }

  // ── verifyWebhookSignature ───────────────────────────────────────────────

  async verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>
  ): Promise<ProviderEvent> {
    if (!config.STRIPE_WEBHOOK_SECRET) {
      logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET is not configured', {
        missingKey: 'STRIPE_WEBHOOK_SECRET',
      });
      throw new Error('Webhook secret not configured');
    }

    const signatureHeader = headers['stripe-signature'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;

    if (!signature) {
      throw new Error('Missing Stripe-Signature header');
    }

    let stripeEvent: Stripe.Event;
    try {
      stripeEvent = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        config.STRIPE_WEBHOOK_SECRET
      );
    } catch {
      throw new Error('Invalid Stripe webhook signature');
    }

    return this.normaliseEvent(stripeEvent);
  }

  // ── handleProviderEvent ──────────────────────────────────────────────────

  async handleProviderEvent(event: ProviderEvent): Promise<void> {
    const stripeEvent = event.rawEvent as Stripe.Event;

    switch (stripeEvent.type) {
      case 'customer.subscription.created':
        await handleSubscriptionCreated(stripeEvent);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(stripeEvent);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent);
        break;

      case 'invoice.payment_succeeded':
        // Re-throw on DB failure so the caller can return HTTP 500 and
        // trigger a Stripe retry — matches the existing webhook pipeline.
        await handleInvoicePaymentSucceeded(stripeEvent);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(stripeEvent);
        break;

      case 'payment_intent.succeeded':
        await this.handleOrderPaymentSucceeded(stripeEvent);
        break;

      case 'payment_intent.payment_failed':
        await this.handleOrderPaymentFailed(stripeEvent);
        break;

      default:
        logger.info('StripeAdapter: unhandled event type', {
          type: stripeEvent.type,
          eventId: stripeEvent.id,
        });
    }
  }

  // ── Private: normalise Stripe event to ProviderEvent ────────────────────

  private normaliseEvent(stripeEvent: Stripe.Event): ProviderEvent {
    const obj = stripeEvent.data.object as Record<string, unknown>;

    // Extract domain identifiers from common Stripe event shapes.
    const metadata = (obj.metadata as Record<string, string> | undefined) ?? {};

    const typeMap: Record<string, ProviderEvent['type']> = {
      'payment_intent.succeeded':          'payment.succeeded',
      'payment_intent.payment_failed':     'payment.failed',
      // Fires for refunds we issued AND for ones a merchant made directly in
      // the Stripe dashboard. Reconciling the latter is what keeps the local
      // ledger from drifting away from what Stripe actually did.
      'charge.refunded':                   'refund.succeeded',
      'customer.subscription.created':     'subscription.created',
      'customer.subscription.updated':     'subscription.updated',
      'customer.subscription.deleted':     'subscription.deleted',
      'invoice.payment_succeeded':         'invoice.paid',
      'invoice.payment_failed':            'invoice.payment_failed',
    };

    return {
      eventId: stripeEvent.id,
      type: typeMap[stripeEvent.type] ?? 'unknown',
      rawEvent: stripeEvent,
      orderId: metadata.orderId,
      customerId: metadata.customerId,
      storeId: metadata.storeId,
    };
  }

  // ── Private: order-level payment handlers (mirrors payment.service.ts) ───
  // These are private because they're not part of the public contract yet.
  // They exist so the adapter is self-contained when payment.service.ts
  // is eventually migrated to use it.

  private async handleOrderPaymentSucceeded(event: Stripe.Event): Promise<void> {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { orderId, customerId } = intent.metadata as { orderId: string; customerId: string };

    if (!orderId || !customerId) {
      logger.error('StripeAdapter: missing metadata in payment_intent.succeeded', {
        intentId: intent.id,
      });
      return;
    }

    const order = await Order.findById(orderId);
    if (!order) {
      logger.error('StripeAdapter: order not found for succeeded payment', {
        orderId,
        intentId: intent.id,
      });
      return;
    }

    // Wrap in try/catch to handle idempotency — a duplicate Stripe delivery
    // will hit the unique index on stripePaymentIntentId (code 11000).
    // In that case, return gracefully rather than re-throwing.
    try {
      await Payment.create({
        orderId: new Types.ObjectId(orderId),
        customerId: new Types.ObjectId(customerId),
        stripePaymentIntentId: intent.id,
        // Explicit provider fields so refunds know which gateway to call and
        // with what reference, instead of inferring it from a prefixed string.
        provider: 'stripe',
        providerPaymentId: intent.id,
        amount: intent.amount,
        currency: intent.currency,
        status: 'succeeded',
        stripeEventId: event.id,
      });
    } catch (err: unknown) {
      const mongoErr = err as { code?: number };
      if (mongoErr.code === 11000) {
        logger.info('StripeAdapter: duplicate payment_intent.succeeded ignored (idempotency)', {
          intentId: intent.id,
          eventId: event.id,
        });
        return;
      }
      throw err; // unexpected DB error — re-throw
    }

    order.status = 'processing';
    // The money has arrived — record it on the payment axis so the order is
    // refundable. Fulfilment and payment move together only at this moment.
    order.paymentStatus = 'paid';
    await order.save();

    const storeId = order.storeId.toString();
    const customer = await User.findById(customerId).lean();
    if (customer?.email) {
      emailService.sendPaymentReceiptEmail(storeId, customer.email, {
        orderId,
        amount: intent.amount,
        currency: intent.currency,
        paymentIntentId: intent.id,
        paidAt: new Date(),
      });
    }

    logger.info('StripeAdapter: payment succeeded — order updated to processing', {
      orderId,
      intentId: intent.id,
    });
  }

  private async handleOrderPaymentFailed(event: Stripe.Event): Promise<void> {
    const intent = event.data.object as Stripe.PaymentIntent;
    const { orderId, customerId } = intent.metadata as { orderId: string; customerId: string };

    if (!orderId || !customerId) {
      logger.error('StripeAdapter: missing metadata in payment_intent.payment_failed', {
        intentId: intent.id,
      });
      return;
    }

    try {
      await Payment.create({
        orderId: new Types.ObjectId(orderId),
        customerId: new Types.ObjectId(customerId),
        stripePaymentIntentId: intent.id,
        amount: intent.amount,
        currency: intent.currency,
        status: 'failed',
        stripeEventId: event.id,
      });
    } catch (err: unknown) {
      const mongoErr = err as { code?: number };
      if (mongoErr.code === 11000) {
        logger.info('StripeAdapter: duplicate payment_intent.payment_failed ignored (idempotency)', {
          intentId: intent.id,
          eventId: event.id,
        });
        return;
      }
      throw err;
    }

    logger.info('StripeAdapter: payment failed — order remains pending', {
      orderId,
      intentId: intent.id,
    });
  }
}
