import Stripe from 'stripe';
import { stripe } from '../../config/stripe';
import { config } from '../../config/index';
import { Payment } from './payment.model';
import { StripeWebhookEvent } from './stripeWebhookEvent.model';
import { User } from '../auth/user.model';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { Types } from 'mongoose';
import { emailService } from '../../services/email.service';
import * as orderRepo from '../orders/order.repository';
import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
} from './subscription.service';

// ── Create Payment Intent ──────────────────────────────────────────────────────

export async function createPaymentIntent(
  orderId: string,
  customerId: string,
  storeId: string
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }

  // Scope the lookup to customerId AND storeId — prevents a customer from
  // creating a payment intent for an order in a different store (item #10).
  const order = await orderRepo.findPendingOrderForPayment(
    orderId,
    new Types.ObjectId(customerId),
    new Types.ObjectId(storeId)
  );

  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');

  if (order.status !== 'pending') {
    throw createError(
      'Payment intent can only be created for pending orders',
      400,
      'BAD_REQUEST'
    );
  }

  // Amount in cents — Stripe requires smallest currency unit
  const amountInCents = Math.round(order.totalAmount * 100);

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: amountInCents,
      // Charge in the currency the order was actually placed in. This was
      // hardcoded 'usd' regardless of the store's currency.
      currency: (order.currency ?? 'USD').toLowerCase(),
      metadata: {
        orderId: orderId,
        customerId: customerId,
      },
    },
    {
      // Idempotency key: same order always produces the same intent
      idempotencyKey: `order_intent_${orderId}`,
    }
  );

  // Attach the paymentIntentId to the order for later reconciliation
  await orderRepo.attachPaymentIntentId(orderId, paymentIntent.id);

  if (!paymentIntent.client_secret) {
    throw createError('Failed to create payment intent', 500, 'INTERNAL_ERROR');
  }

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };
}

// ── Webhook Handler ────────────────────────────────────────────────────────────

/**
 * Main webhook entry point called by the controller.
 *
 * Pipeline (matches design doc pseudo-code):
 *  1. Signature verification   — HTTP 400 on failure, no further processing
 *  2. Structured entry log     — INFO with eventId + type
 *  3. Idempotency check        — HTTP 200 + early return on duplicate
 *  4. Event dispatch           — wrapped in try/catch (see below)
 *  5. Record processed event   — insert AFTER dispatch so crashes remain retryable
 *  6. Timeout guard            — WARN + early return if elapsed > 25 s
 *  7. Outer catch              — absorbs all exceptions; responds 200 except for
 *                                invoice.payment_succeeded DB failures (re-thrown
 *                                so Stripe retries via HTTP 500)
 *
 * ⚠️  STRIPE_WEBHOOK_SECRET must be set in .env:
 *     STRIPE_WEBHOOK_SECRET=whsec_<your_signing_secret_from_stripe_dashboard>
 */
export async function handleWebhook(
  rawBody: Buffer,
  signature: string
): Promise<void> {
  // ── [STEP 1] Signature verification ─────────────────────────────────────────
  // Guard: STRIPE_WEBHOOK_SECRET must be configured.
  if (!config.STRIPE_WEBHOOK_SECRET) {
    logger.error('CRITICAL: STRIPE_WEBHOOK_SECRET is not configured — webhook handler is inoperative', {
      missingKey: 'STRIPE_WEBHOOK_SECRET',
    });
    throw createError('Webhook secret not configured', 500, 'INTERNAL_ERROR');
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    // Tampered payload, wrong secret, or clock skew > 5 min
    throw createError('Invalid webhook signature', 400, 'BAD_REQUEST');
  }

  // Record wall-clock time to enforce the 25-second timeout guard later.
  const startTime = Date.now();

  // ── [STEP 2] Structured entry log ────────────────────────────────────────────
  // Extract whichever identifier is present in this event type.
  const obj = event.data.object as Record<string, unknown>;
  const stripeRef = (obj.customer as string | undefined)
    ?? (obj.subscription as string | undefined)
    ?? (obj.id as string | undefined);

  logger.info('Stripe webhook received', {
    eventId: event.id,
    type: event.type,
    stripeRef,
  });

  // ── [STEP 3] Idempotency check ───────────────────────────────────────────────
  // Query StripeWebhookEvent (not Payment) — subscription events are not orders.
  const alreadyProcessed = await StripeWebhookEvent.findOne({
    stripeEventId: event.id,
  }).lean();

  if (alreadyProcessed) {
    logger.info('Duplicate webhook event ignored', {
      eventId: event.id,
      type: event.type,
    });
    return;
  }

  // ── [STEP 4] Event dispatch ──────────────────────────────────────────────────
  // The outer try/catch (step 7) wraps this block.
  // invoice.payment_succeeded DB failures are intentionally re-thrown so Stripe
  // retries (HTTP 500).  All other failures are absorbed (HTTP 200).
  try {
    switch (event.type) {
      // ── Subscription lifecycle (Phase 3 — subscription.service.ts) ──────────
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;

      case 'invoice.payment_succeeded':
        await handleInvoicePaymentSucceeded(event);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event);
        break;

      // ── Order payment intents (existing handlers) ────────────────────────────
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event);
        break;

      default:
        // Unhandled event type — acknowledge without processing.
        // This is normal; Stripe sends many event types we don't need.
        logger.info('Unhandled Stripe event type — no action taken', {
          type: event.type,
          eventId: event.id,
        });
    }

    // ── [STEP 5] Record processed event (post-dispatch) ──────────────────────
    // Inserting AFTER dispatch means a handler crash leaves no record, so Stripe
    // will retry.  A duplicate-key error here means a concurrent delivery won
    // the race — treat it as a no-op (not an error).
    try {
      await StripeWebhookEvent.create({
        stripeEventId: event.id,
        type: event.type,
        processedAt: new Date(),
      });
    } catch (dupErr: unknown) {
      const mongoErr = dupErr as { code?: number };
      if (mongoErr.code === 11000) {
        // Race-condition duplicate — the concurrent delivery already inserted.
        logger.info('StripeWebhookEvent race-condition duplicate — ignored', {
          eventId: event.id,
        });
      } else {
        throw dupErr; // unexpected DB error — let the outer catch handle it
      }
    }

    // ── [STEP 6] Timeout guard ───────────────────────────────────────────────
    // Warn if processing took > 25 s (Stripe's limit is 30 s).
    const elapsed = Date.now() - startTime;
    if (elapsed > 25_000) {
      logger.warn('Webhook processing exceeded 25 s — consider async offloading', {
        eventId: event.id,
        type: event.type,
        elapsedMs: elapsed,
      });
      // The controller will still respond 200 — we just log the warning.
    }

  } catch (err) {
    // ── [STEP 7] Outer catch ─────────────────────────────────────────────────
    // Log every unhandled exception with full context for debugging.
    const error = err as Error;
    logger.error('Unhandled exception during webhook processing', {
      eventId: event.id,
      type: event.type,
      message: error.message,
      stack: error.stack,
    });

    // Re-throw ONLY for invoice.payment_succeeded so Stripe retries via HTTP 500.
    // All other failures are absorbed — returning normally causes the controller
    // to respond HTTP 200, which prevents infinite Stripe retries for
    // non-retriable errors (missing store, unknown price ID, etc.).
    if (event.type === 'invoice.payment_succeeded') {
      throw err;
    }
  }
}

// ── Internal event handlers ────────────────────────────────────────────────────

async function handlePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const { orderId, customerId } = intent.metadata as { orderId: string; customerId: string };

  if (!orderId || !customerId) {
    logger.error('Missing metadata in payment_intent.succeeded', { intentId: intent.id });
    return;
  }

  const order = await orderRepo.findOrderDocumentByOrderIdOnly(orderId);
  if (!order) {
    logger.error('Order not found for succeeded payment', { orderId, intentId: intent.id });
    return;
  }

  // Record the payment. A duplicate delivery collides on the unique
  // stripeEventId index; that is a no-op, NOT a failure, and must not stop the
  // order transition below. (Previously this threw and the order silently
  // stayed 'pending' even though the card had been charged.)
  try {
    await Payment.create({
      orderId: new Types.ObjectId(orderId),
      customerId: new Types.ObjectId(customerId),
      stripePaymentIntentId: intent.id,
      amount: intent.amount,
      currency: intent.currency,
      status: 'succeeded',
      stripeEventId: event.id,
    });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    logger.info('Payment already recorded for this event — continuing', {
      eventId: event.id,
      intentId: intent.id,
    });
  }

  // Atomic pending -> processing. Only the caller that actually performed the
  // transition sends the receipt, so concurrent deliveries cannot double-email,
  // and a replayed event cannot resurrect a cancelled order.
  const transitioned = await orderRepo.markOrderProcessingIfPending(orderId);

  if (!transitioned) {
    logger.info('Order was not pending — no transition or receipt sent', {
      orderId,
      intentId: intent.id,
      currentStatus: order.status,
    });
    return;
  }

  // Send payment receipt email (fire-and-forget)
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

  logger.info('Payment succeeded — order updated to processing', {
    orderId,
    intentId: intent.id,
  });
}

async function handlePaymentFailed(event: Stripe.Event): Promise<void> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const { orderId, customerId } = intent.metadata as { orderId: string; customerId: string };

  if (!orderId || !customerId) {
    logger.error('Missing metadata in payment_intent.payment_failed', { intentId: intent.id });
    return;
  }

  // Record the failure — order stays in 'pending' so customer can retry.
  // Duplicate deliveries collide on stripeEventId and are ignored.
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
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    logger.info('Payment failure already recorded for this event', { eventId: event.id });
  }

  logger.info('Payment failed — order remains pending', {
    orderId,
    intentId: intent.id,
  });
}
