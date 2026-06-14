/**
 * Integration tests for the Payment Provider abstraction layer.
 *
 * Feature: stripe-subscription-billing / payment-provider-interface
 *
 * What these tests verify
 * ───────────────────────
 * 1. SIGNATURE REJECTION  — verifyWebhookSignature() correctly rejects a
 *    tampered/unsigned payload (expected behaviour without real Stripe keys).
 *
 * 2. PAYMENT SUCCEEDED    — handleProviderEvent() with a 'payment_intent.succeeded'
 *    ProviderEvent updates the Order status from 'pending' → 'processing' in MongoDB
 *    and creates a Payment record.
 *
 * 3. PAYMENT FAILED       — handleProviderEvent() with a 'payment_intent.payment_failed'
 *    ProviderEvent creates a failed Payment record and leaves the Order in 'pending'.
 *
 * 4. UNKNOWN EVENT        — handleProviderEvent() with an unrecognised event type
 *    is a no-op (no throw, no DB mutation).
 *
 * Mocking strategy
 * ─────────────────
 * Stripe SDK calls are mocked at the module level so no real API key is needed.
 * MongoDB uses the real database connection from your .env file — this is an
 * integration test, not a unit test. Test data is created fresh and cleaned up
 * after each test to avoid contaminating real data.
 *
 * How to run
 * ──────────
 *   cd backend
 *   npx jest tests/integration/payment-provider.integration.test.ts --runInBand
 *
 * --runInBand runs tests sequentially to avoid race conditions on shared DB state.
 */

// ── Mock Stripe SDK (must come before any imports that load Stripe) ────────────
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn().mockResolvedValue({
        id: 'pi_mock_123',
        client_secret: 'pi_mock_123_secret',
        amount: 5000,
        currency: 'usd',
      }),
    },
    webhooks: {
      constructEvent: jest.fn().mockImplementation(() => {
        // Always throw — simulates a missing/wrong STRIPE_WEBHOOK_SECRET.
        // This is the correct behaviour in a test environment with no real keys.
        throw new Error('No signatures found matching the expected signature for payload');
      }),
    },
  }));
});

// Mock email service so no SMTP calls fire during tests
jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendPaymentReceiptEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

import mongoose, { Types } from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { Order } from '../../src/modules/orders/order.model';
import { Payment } from '../../src/modules/payments/payment.model';
import { StripeWebhookEvent } from '../../src/modules/payments/stripeWebhookEvent.model';
import { paymentProviderFactory } from '../../src/modules/payments/providers/payment-provider.factory';
import type { ProviderEvent } from '../../src/modules/payments/providers/payment-provider.interface';

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_STORE_ID  = new Types.ObjectId();
const TEST_USER_ID   = new Types.ObjectId();

/** Creates a minimal pending order in the DB and returns its string ID. */
async function seedPendingOrder(): Promise<string> {
  const order = await Order.create({
    storeId:  TEST_STORE_ID,
    customerId: TEST_USER_ID,
    items: [{
      productId: new Types.ObjectId(),
      name:      'Test Product',
      price:     50,
      quantity:  1,
    }],
    totalAmount: 50,
    status:      'pending',
    paymentMethod: 'online',
    discountAmount: 0,
    shippingAddress: {
      line1:      '123 Test Street',
      city:       'Cairo',
      state:      'Cairo',
      postalCode: '11511',
      country:    'EG',
    },
  });
  return (order._id as Types.ObjectId).toString();
}

/** Builds a minimal ProviderEvent for order-level payment events. */
function makeOrderPaymentEvent(
  type: 'payment.succeeded' | 'payment.failed',
  orderId: string,
  eventId: string = `evt_test_${Date.now()}`
): ProviderEvent {
  const stripeType = type === 'payment.succeeded'
    ? 'payment_intent.succeeded'
    : 'payment_intent.payment_failed';

  // Each event must have a unique PaymentIntent ID — the Payment model enforces
  // a unique index on stripePaymentIntentId. Derive it from the eventId so
  // tests that reuse the same eventId (idempotency test) also reuse the same PI ID.
  const paymentIntentId = `pi_test_${eventId}`;

  return {
    eventId,
    type,
    rawEvent: {
      id: eventId,
      type: stripeType,
      data: {
        object: {
          id: paymentIntentId,
          amount: 5000,
          currency: 'usd',
          metadata: {
            orderId,
            customerId: TEST_USER_ID.toString(),
          },
        },
      },
    } as unknown,
    orderId,
    customerId: TEST_USER_ID.toString(),
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
});

afterAll(async () => {
  // Clean up test documents created during this run
  await Order.deleteMany({ storeId: TEST_STORE_ID });
  await Payment.deleteMany({ customerId: TEST_USER_ID });
  await StripeWebhookEvent.deleteMany({ stripeEventId: /^evt_test_/ });
  await mongoose.connection.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StripeAdapter — payment provider integration', () => {
  const adapter = paymentProviderFactory.get('stripe');

  // ── Test 1: Signature rejection ─────────────────────────────────────────
  describe('verifyWebhookSignature', () => {
    it('should throw when the Stripe-Signature header is missing', async () => {
      const rawBody = Buffer.from('{"id":"evt_test","type":"payment_intent.succeeded"}');

      await expect(
        adapter.verifyWebhookSignature(rawBody, {})  // no headers
      ).rejects.toThrow('Missing Stripe-Signature header');
    });

    it('should throw when the signature is invalid (expected without real keys)', async () => {
      const rawBody = Buffer.from('{"id":"evt_test","type":"payment_intent.succeeded"}');

      await expect(
        adapter.verifyWebhookSignature(rawBody, {
          'stripe-signature': 'v1=invalid_signature_no_real_key',
        })
      ).rejects.toThrow();
      // The exact message comes from Stripe SDK — we just assert it throws.
      // ✅  This is the CORRECT outcome: an invalid signature is rejected.
    });
  });

  // ── Test 2: payment.succeeded → DB update ───────────────────────────────
  describe('handleProviderEvent — payment.succeeded', () => {
    it('should update order status to processing and create a Payment record', async () => {
      const orderId = await seedPendingOrder();
      const eventId = `evt_test_success_${Date.now()}`;
      const event   = makeOrderPaymentEvent('payment.succeeded', orderId, eventId);

      // Act
      await adapter.handleProviderEvent(event);

      // Assert: order status updated
      const updatedOrder = await Order.findById(orderId).lean();
      expect(updatedOrder).not.toBeNull();
      expect(updatedOrder!.status).toBe('processing');

      // Assert: Payment record created
      const payment = await Payment.findOne({
        orderId: new Types.ObjectId(orderId),
      }).lean();
      expect(payment).not.toBeNull();
      expect(payment!.status).toBe('succeeded');
      expect(payment!.stripeEventId).toBe(eventId);

      console.log(`✅  payment.succeeded: Order ${orderId} → 'processing', Payment record created`);
    });
  });

  // ── Test 3: payment.failed → Order stays pending ────────────────────────
  describe('handleProviderEvent — payment.failed', () => {
    it('should create a failed Payment record and leave order in pending', async () => {
      const orderId = await seedPendingOrder();
      const eventId = `evt_test_failed_${Date.now()}`;
      const event   = makeOrderPaymentEvent('payment.failed', orderId, eventId);

      // Act
      await adapter.handleProviderEvent(event);

      // Assert: order NOT advanced
      const unchangedOrder = await Order.findById(orderId).lean();
      expect(unchangedOrder).not.toBeNull();
      expect(unchangedOrder!.status).toBe('pending');

      // Assert: failed Payment record created
      const payment = await Payment.findOne({
        orderId: new Types.ObjectId(orderId),
      }).lean();
      expect(payment).not.toBeNull();
      expect(payment!.status).toBe('failed');
      expect(payment!.stripeEventId).toBe(eventId);

      console.log(`✅  payment.failed: Order ${orderId} stays 'pending', failed Payment record created`);
    });
  });

  // ── Test 4: Unknown event type → no-op ──────────────────────────────────
  describe('handleProviderEvent — unknown event type', () => {
    it('should not throw and should not modify any orders', async () => {
      const orderId = await seedPendingOrder();

      const unknownEvent: ProviderEvent = {
        eventId: `evt_test_unknown_${Date.now()}`,
        type: 'unknown',
        rawEvent: {
          id: 'evt_unknown',
          type: 'some.future.event',
          data: { object: {} },
        },
      };

      // Should not throw
      await expect(adapter.handleProviderEvent(unknownEvent)).resolves.toBeUndefined();

      // Order should be untouched
      const order = await Order.findById(orderId).lean();
      expect(order!.status).toBe('pending');

      console.log('✅  unknown event: no-op, no DB mutation');
    });
  });

  // ── Test 5: Duplicate event idempotency ─────────────────────────────────
  describe('handleProviderEvent — idempotency on duplicate events', () => {
    it('should process the same payment.succeeded event twice without error', async () => {
      const orderId = await seedPendingOrder();
      const eventId = `evt_test_idem_${Date.now()}`;
      const event   = makeOrderPaymentEvent('payment.succeeded', orderId, eventId);

      // First processing — normal
      await adapter.handleProviderEvent(event);

      // Second processing of the same event — should not throw or create a
      // duplicate Payment record (the unique index on stripeEventId handles this)
      // The adapter catches the duplicate-key error internally.
      await expect(adapter.handleProviderEvent(event)).resolves.not.toThrow();

      // Still exactly one Payment record for this event
      const paymentCount = await Payment.countDocuments({ stripeEventId: eventId });
      expect(paymentCount).toBe(1);

      console.log(`✅  idempotency: duplicate event ${eventId} handled gracefully, single Payment record`);
    });
  });
});
