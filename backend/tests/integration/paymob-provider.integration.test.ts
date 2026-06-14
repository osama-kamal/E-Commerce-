/**
 * Integration tests for the PaymobAdapter.
 *
 * All Paymob HTTP API calls are mocked — no real network requests.
 * MongoDB uses your real DB from .env for Order/Payment state assertions.
 *
 * How to run:
 *   cd backend
 *   npx jest tests/integration/paymob-provider.integration.test.ts --runInBand --verbose
 *
 * Required .env keys (add real values when available):
 *   PAYMOB_API_KEY=<from Paymob Dashboard>
 *   PAYMOB_SECRET_KEY=<from Paymob Dashboard>
 *   PAYMOB_HMAC_SECRET=<from Paymob Dashboard>
 *   PAYMOB_INTEGRATION_ID_CARD=<from Paymob Dashboard>
 */

// ── Mock Paymob HTTP calls ─────────────────────────────────────────────────────
// We only intercept https.request — everything else (Agent, createServer, etc.)
// is passed through from the real https module so the Stripe SDK can load without error.

jest.mock('https', () => {
  const realHttps = jest.requireActual<typeof import('https')>('https');
  const EventEmitter = require('events');

  // Tracks call count so we can return different mock responses per Paymob API step
  let callCount = 0;

  const mockRequest = jest.fn().mockImplementation((_opts: unknown, callback: (res: unknown) => void) => {
    callCount++;

    const responses: Record<number, unknown> = {
      1: { token: 'mock_auth_token_abc123' },    // Step 1 — authenticate
      2: { id: 99999 },                           // Step 2 — create order
      3: { token: 'mock_payment_token_xyz789' },  // Step 3 — payment key
    };

    const body = responses[callCount] ?? {};

    setImmediate(() => {
      const res = new EventEmitter() as NodeJS.EventEmitter & { statusCode: number };
      res.statusCode = 200;
      callback(res);
      res.emit('data', JSON.stringify(body));
      res.emit('end');
    });

    const req = new EventEmitter() as NodeJS.EventEmitter & { write: jest.Mock; end: jest.Mock };
    req.write = jest.fn();
    req.end = jest.fn();
    return req;
  });

  // Expose reset helper so individual tests can reset the call counter
  (mockRequest as jest.Mock & { __resetCallCount: () => void }).__resetCallCount = () => {
    callCount = 0;
  };

  // Return the real https module with only https.request swapped out
  return {
    ...realHttps,
    request: mockRequest,
  };
});

// Mock email to avoid SMTP noise
jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendPaymentReceiptEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

// Mock Stripe SDK — the factory imports StripeAdapter which loads Stripe at
// module evaluation time. Even though Paymob tests don't call Stripe methods,
// the SDK constructor runs when the module is first required.
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  }));
});

// ─────────────────────────────────────────────────────────────────────────────

import mongoose, { Types } from 'mongoose';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

// Ensure env vars are set for the tests (use mock values if not in .env)
process.env.PAYMOB_API_KEY                = process.env.PAYMOB_API_KEY                ?? 'mock_api_key';
process.env.PAYMOB_HMAC_SECRET            = process.env.PAYMOB_HMAC_SECRET            ?? 'mock_hmac_secret_32chars_minimum!!';
process.env.PAYMOB_INTEGRATION_ID_CARD    = process.env.PAYMOB_INTEGRATION_ID_CARD    ?? '12345';
process.env.PAYMOB_SECRET_KEY             = process.env.PAYMOB_SECRET_KEY             ?? 'mock_secret';

import { Order } from '../../src/modules/orders/order.model';
import { Payment } from '../../src/modules/payments/payment.model';
import { paymentProviderFactory } from '../../src/modules/payments/providers/payment-provider.factory';
import type { ProviderEvent } from '../../src/modules/payments/providers/payment-provider.interface';

// ── Test constants ────────────────────────────────────────────────────────────

const TEST_STORE_ID  = new Types.ObjectId();
const TEST_USER_ID   = new Types.ObjectId();

async function seedPendingOrder(): Promise<string> {
  const order = await Order.create({
    storeId:  TEST_STORE_ID,
    customerId: TEST_USER_ID,
    items: [{ productId: new Types.ObjectId(), name: 'Test Item', price: 100, quantity: 1 }],
    totalAmount: 100,
    status: 'pending',
    paymentMethod: 'online',
    discountAmount: 0,
    shippingAddress: { line1: '1 Test St', city: 'Cairo', state: 'Cairo', postalCode: '11511', country: 'EG' },
  });
  return (order._id as Types.ObjectId).toString();
}

/** Builds a Paymob-style callback payload with a valid HMAC. */
function buildPaymobCallback(
  transId: number,
  orderId: string,
  isSuccess: boolean,
  hmacSecret: string
): { payload: Record<string, unknown>; hmac: string } {
  const obj = {
    amount_cents: 10000,
    created_at: '2024-01-01T00:00:00',
    currency: 'EGP',
    error_occured: String(!isSuccess),
    has_parent_transaction: 'false',
    id: String(transId),
    integration_id: '12345',
    is_3d_secure: 'false',
    is_auth: 'false',
    is_capture: 'false',
    is_refunded: 'false',
    is_standalone_payment: 'true',
    is_voided: 'false',
    order: { id: '99999', merchant_order_id: orderId },
    owner: '1',
    pending: 'false',
    source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    success: String(isSuccess),
  };

  // Build HMAC using the same field order as the adapter
  const fields = [
    obj.amount_cents, obj.created_at, obj.currency, obj.error_occured,
    obj.has_parent_transaction, obj.id, obj.integration_id, obj.is_3d_secure,
    obj.is_auth, obj.is_capture, obj.is_refunded, obj.is_standalone_payment,
    obj.is_voided, obj.order.id, obj.owner, obj.pending,
    obj.source_data.pan, obj.source_data.sub_type, obj.source_data.type,
    obj.success,
  ];

  const hmac = crypto
    .createHmac('sha512', hmacSecret)
    .update(fields.join(''))
    .digest('hex')
    .toLowerCase();

  return { payload: { obj, hmac }, hmac };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce';
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(uri);
  }
  // Reset the factory cache so PaymobAdapter is freshly created
  paymentProviderFactory.clearCache();
});

afterAll(async () => {
  await Order.deleteMany({ storeId: TEST_STORE_ID });
  await Payment.deleteMany({ customerId: TEST_USER_ID });
  await mongoose.connection.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PaymobAdapter — payment provider integration', () => {
  const adapter = paymentProviderFactory.get('paymob');

  // ── Test 1: Factory returns a PaymobAdapter ──────────────────────────────
  it('paymentProviderFactory.get("paymob") returns the PaymobAdapter', () => {
    expect(adapter.name).toBe('paymob');
  });

  // ── Test 2: initiatePayment calls the 3-step Paymob flow ────────────────
  it('initiatePayment returns paymentToken and iframeUrl from Paymob', async () => {
    // Reset the mock HTTP call counter so Step 1/2/3 map correctly
    const https = require('https');
    https.request.__resetCallCount();

    const orderId = await seedPendingOrder();

    const result = await adapter.initiatePayment({
      orderId,
      customerId: TEST_USER_ID.toString(),
      storeId:    TEST_STORE_ID.toString(),
      amountInSmallestUnit: 10000,
      currency: 'egp',
    });

    expect(result.providerPaymentId).toBe('99999');
    expect(result.clientData.paymentToken).toBe('mock_payment_token_xyz789');
    expect(result.clientData.iframeUrl).toContain('mock_payment_token_xyz789');

    // Order should have paymobOrderId stored in paymentIntentId
    const updatedOrder = await Order.findById(orderId).lean();
    expect(updatedOrder!.paymentIntentId).toBe('99999');

    console.log(`✅  initiatePayment: orderId=${orderId}, paymobOrderId=99999`);
  });

  // ── Test 3: verifyWebhookSignature — valid HMAC ─────────────────────────
  it('verifyWebhookSignature accepts a correctly-signed Paymob callback', async () => {
    const orderId = await seedPendingOrder();
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
    const { payload } = buildPaymobCallback(88888, orderId, true, hmacSecret);

    const rawBody = Buffer.from(JSON.stringify(payload));
    const event = await adapter.verifyWebhookSignature(rawBody, {});

    expect(event.type).toBe('payment.succeeded');
    expect(event.orderId).toBe(orderId);
    expect(event.eventId).toBe('paymob_88888');

    console.log('✅  verifyWebhookSignature: valid HMAC accepted, event normalised correctly');
  });

  // ── Test 4: verifyWebhookSignature — invalid HMAC ───────────────────────
  it('verifyWebhookSignature rejects a tampered callback (wrong HMAC)', async () => {
    const orderId = await seedPendingOrder();
    const { payload } = buildPaymobCallback(77777, orderId, true, 'mock_hmac_secret_32chars_minimum!!');
    const tampered = { ...payload, hmac: 'deadbeef00000000' }; // wrong HMAC

    const rawBody = Buffer.from(JSON.stringify(tampered));

    await expect(
      adapter.verifyWebhookSignature(rawBody, {})
    ).rejects.toThrow('HMAC signature mismatch');

    console.log('✅  verifyWebhookSignature: tampered HMAC correctly rejected');
  });

  // ── Test 5: handleProviderEvent — payment.succeeded ─────────────────────
  it('handleProviderEvent updates order to processing on payment.succeeded', async () => {
    const orderId = await seedPendingOrder();
    const transId = Date.now();
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
    const { payload } = buildPaymobCallback(transId, orderId, true, hmacSecret);
    const rawBody = Buffer.from(JSON.stringify(payload));

    // Verify then handle
    const event = await adapter.verifyWebhookSignature(rawBody, {});
    await adapter.handleProviderEvent(event);

    const updatedOrder = await Order.findById(orderId).lean();
    expect(updatedOrder!.status).toBe('processing');

    const payment = await Payment.findOne({ orderId: new Types.ObjectId(orderId) }).lean();
    expect(payment).not.toBeNull();
    expect(payment!.status).toBe('succeeded');

    console.log(`✅  handleProviderEvent(payment.succeeded): order ${orderId} → 'processing'`);
  });

  // ── Test 6: handleProviderEvent — payment.failed ────────────────────────
  it('handleProviderEvent leaves order pending on payment.failed', async () => {
    const orderId = await seedPendingOrder();
    const transId = Date.now() + 1;
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
    const { payload } = buildPaymobCallback(transId, orderId, false, hmacSecret);
    const rawBody = Buffer.from(JSON.stringify(payload));

    const event = await adapter.verifyWebhookSignature(rawBody, {});
    await adapter.handleProviderEvent(event);

    const order = await Order.findById(orderId).lean();
    expect(order!.status).toBe('pending');

    const payment = await Payment.findOne({ orderId: new Types.ObjectId(orderId) }).lean();
    expect(payment!.status).toBe('failed');

    console.log(`✅  handleProviderEvent(payment.failed): order ${orderId} stays 'pending'`);
  });
});
