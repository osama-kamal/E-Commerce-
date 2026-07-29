/**
 * Webhook idempotency under concurrent delivery.
 *
 * handleWebhook checks StripeWebhookEvent for the event id, dispatches the
 * handler, and only THEN records the event. Two concurrent deliveries of the
 * same event therefore both pass the check and both dispatch.
 *
 * These tests establish what that actually costs in practice, and pin the
 * invariants that must hold no matter how many times Stripe delivers an event:
 * one payment record, one order transition, one receipt email, one audit row.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

const constructEvent = jest.fn();

jest.mock('../../src/config/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: (...a: unknown[]) => constructEvent(...a) },
    paymentIntents: { create: jest.fn() },
  },
}));

const sendPaymentReceiptEmail = jest.fn();
jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendPaymentReceiptEmail: (...a: unknown[]) => sendPaymentReceiptEmail(...a),
    sendOrderConfirmationEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendOrderStatusEmail: jest.fn(),
    sendEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

import { config } from '../../src/config/index';
import { handleWebhook } from '../../src/modules/payments/payment.service';
import { Payment } from '../../src/modules/payments/payment.model';
import { StripeWebhookEvent } from '../../src/modules/payments/stripeWebhookEvent.model';
import { Order } from '../../src/modules/orders/order.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';

let mongod: MongoMemoryServer;
let order: InstanceType<typeof Order>;
let customerId: Types.ObjectId;

const EVENT_ID = 'evt_concurrent_1';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // handleWebhook refuses to run without a configured signing secret.
  (config as unknown as { STRIPE_WEBHOOK_SECRET?: string }).STRIPE_WEBHOOK_SECRET = 'whsec_test';
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all([
    Payment.deleteMany({}), StripeWebhookEvent.deleteMany({}),
    Order.deleteMany({}), User.deleteMany({}), Store.deleteMany({}),
  ]);

  const store = await Store.create({
    name: 'WH Store', slug: 'wh-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'trialing',
  });
  const customer = await User.create({
    storeId: store._id, email: 'wh@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerId = customer._id as Types.ObjectId;

  order = await Order.create({
    storeId: store._id,
    customerId,
    items: [{ productId: new Types.ObjectId(), name: 'Item', price: 50, quantity: 1 }],
    totalAmount: 50,
    status: 'pending',
    shippingAddress: { line1: 'a', city: 'b', state: 'c', postalCode: 'd', country: 'e' },
  });

  constructEvent.mockReturnValue({
    id: EVENT_ID,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_test_1',
        amount: 5000,
        currency: 'usd',
        metadata: { orderId: order._id!.toString(), customerId: customerId.toString() },
      },
    },
  });
});

const deliver = () => handleWebhook(Buffer.from('{}'), 'sig');

// ── Sequential redelivery (Stripe's normal retry) ───────────────────────────

describe('sequential redelivery', () => {
  it('applies the payment exactly once across three deliveries', async () => {
    await deliver();
    await deliver();
    await deliver();

    expect(await Payment.countDocuments({})).toBe(1);
    expect(await StripeWebhookEvent.countDocuments({ stripeEventId: EVENT_ID })).toBe(1);
    expect(sendPaymentReceiptEmail).toHaveBeenCalledTimes(1);

    const after = await Order.findById(order._id).lean();
    expect(after!.status).toBe('processing');
  });
});

// ── Concurrent delivery (the race) ──────────────────────────────────────────

describe('concurrent delivery of the same event', () => {
  it('creates exactly one payment record', async () => {
    await Promise.allSettled([deliver(), deliver()]);
    expect(await Payment.countDocuments({})).toBe(1);
  });

  it('sends exactly one receipt email', async () => {
    await Promise.allSettled([deliver(), deliver()]);
    expect(sendPaymentReceiptEmail).toHaveBeenCalledTimes(1);
  });

  it('writes exactly one audit row', async () => {
    await Promise.allSettled([deliver(), deliver()]);
    expect(await StripeWebhookEvent.countDocuments({ stripeEventId: EVENT_ID })).toBe(1);
  });

  it('leaves the order in processing', async () => {
    await Promise.allSettled([deliver(), deliver()]);
    const after = await Order.findById(order._id).lean();
    expect(after!.status).toBe('processing');
  });

  it('survives five simultaneous deliveries', async () => {
    await Promise.allSettled([deliver(), deliver(), deliver(), deliver(), deliver()]);

    expect(await Payment.countDocuments({})).toBe(1);
    expect(sendPaymentReceiptEmail).toHaveBeenCalledTimes(1);
    expect(await StripeWebhookEvent.countDocuments({ stripeEventId: EVENT_ID })).toBe(1);
  });
});

// ── Retry on the same PaymentIntent after a failure ─────────────────────────
//
// Stripe reuses one PaymentIntent across card retries: a declined card emits
// payment_intent.payment_failed, the customer re-confirms with another card, and
// the SAME intent then emits payment_intent.succeeded.

describe('payment retry on the same intent', () => {
  it('advances the order to processing when a previously failed intent succeeds', async () => {
    constructEvent.mockReturnValueOnce({
      id: 'evt_failed_1',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_1',
          amount: 5000,
          currency: 'usd',
          metadata: { orderId: order._id!.toString(), customerId: customerId.toString() },
        },
      },
    });
    await deliver().catch(() => {});

    expect((await Order.findById(order._id).lean())!.status).toBe('pending');

    // Customer retries with a good card — same intent id, new event id.
    await deliver();

    const after = await Order.findById(order._id).lean();
    expect(after!.status).toBe('processing');
    expect(sendPaymentReceiptEmail).toHaveBeenCalledTimes(1);
  });

  it('records both the failure and the success for the same intent', async () => {
    constructEvent.mockReturnValueOnce({
      id: 'evt_failed_2',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_test_1',
          amount: 5000,
          currency: 'usd',
          metadata: { orderId: order._id!.toString(), customerId: customerId.toString() },
        },
      },
    });
    await deliver().catch(() => {});
    await deliver();

    const payments = await Payment.find({ stripePaymentIntentId: 'pi_test_1' }).lean();
    const statuses = payments.map((p) => p.status).sort();
    expect(statuses).toEqual(['failed', 'succeeded']);
  });
});

// ── Failed dispatch must remain retryable ───────────────────────────────────

describe('failed dispatch', () => {
  it('does not record the event when the handler throws, so Stripe can retry', async () => {
    // Order missing -> handlePaymentSucceeded logs and returns without applying.
    // Simulate a genuine failure instead: break the Payment write.
    const spy = jest.spyOn(Payment, 'create').mockRejectedValueOnce(
      new Error('transient db failure') as never
    );

    await deliver().catch(() => { /* absorbed by design for non-invoice events */ });

    expect(await StripeWebhookEvent.countDocuments({ stripeEventId: EVENT_ID })).toBe(0);
    spy.mockRestore();
  });

  it('applies the event on a later retry after a transient failure', async () => {
    const spy = jest.spyOn(Payment, 'create').mockRejectedValueOnce(
      new Error('transient db failure') as never
    );
    await deliver().catch(() => {});
    spy.mockRestore();

    await deliver();

    expect(await Payment.countDocuments({})).toBe(1);
    const after = await Order.findById(order._id).lean();
    expect(after!.status).toBe('processing');
    expect(await StripeWebhookEvent.countDocuments({ stripeEventId: EVENT_ID })).toBe(1);
  });
});
