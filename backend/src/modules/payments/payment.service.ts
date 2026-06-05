import Stripe from 'stripe';
import { stripe } from '../../config/stripe';
import { config } from '../../config/index';
import { Payment } from './payment.model';
import { Order } from '../orders/order.model';
import { User } from '../auth/user.model';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { Types } from 'mongoose';
import { emailService } from '../../services/email.service';

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
  const order = await Order.findOne({
    _id: orderId,
    customerId: new Types.ObjectId(customerId),
    storeId: new Types.ObjectId(storeId),
  }).lean();

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
      currency: 'usd',
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
  await Order.updateOne({ _id: orderId }, { paymentIntentId: paymentIntent.id });

  if (!paymentIntent.client_secret) {
    throw createError('Failed to create payment intent', 500, 'INTERNAL_ERROR');
  }

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
  };
}

// ── Webhook Handler ────────────────────────────────────────────────────────────

export async function handleWebhook(
  rawBody: Buffer,
  signature: string
): Promise<void> {
  let event: Stripe.Event;

  // Verify Stripe signature — rejects tampered or unsigned requests
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    throw createError('Invalid webhook signature', 400, 'BAD_REQUEST');
  }

  // Idempotency guard — skip if we've already processed this event
  const alreadyProcessed = await Payment.findOne({ stripeEventId: event.id }).lean();
  if (alreadyProcessed) {
    logger.info('Duplicate webhook event ignored', { eventId: event.id });
    return;
  }

  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentSucceeded(event);
      break;

    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event);
      break;

    default:
      // Unhandled event types — acknowledge without processing
      logger.info('Unhandled Stripe event type', { type: event.type });
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

  const order = await Order.findById(orderId);
  if (!order) {
    logger.error('Order not found for succeeded payment', { orderId, intentId: intent.id });
    return;
  }

  // Create payment record — stripeEventId unique index prevents duplicates
  await Payment.create({
    orderId: new Types.ObjectId(orderId),
    customerId: new Types.ObjectId(customerId),
    stripePaymentIntentId: intent.id,
    amount: intent.amount,
    currency: intent.currency,
    status: 'succeeded',
    stripeEventId: event.id,
  });

  // Advance order to processing
  order.status = 'processing';
  await order.save();

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

  // Record the failure — order stays in 'pending' so customer can retry
  await Payment.create({
    orderId: new Types.ObjectId(orderId),
    customerId: new Types.ObjectId(customerId),
    stripePaymentIntentId: intent.id,
    amount: intent.amount,
    currency: intent.currency,
    status: 'failed',
    stripeEventId: event.id,
  });

  logger.info('Payment failed — order remains pending', {
    orderId,
    intentId: intent.id,
  });
}
