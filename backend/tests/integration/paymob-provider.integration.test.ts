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
import { logger } from '../../src/utils/logger';
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

  // ── HMAC comparison is constant-time and total ──────────────────────────
  //
  // The comparison was `computedHmac !== receivedHmac`, which short-circuits at
  // the first differing character and so leaks how many leading characters a
  // candidate got right. It is now crypto.timingSafeEqual.
  //
  // timingSafeEqual THROWS on a length mismatch, and building its buffers with
  // `Buffer.from(str, 'hex')` would silently truncate attacker-controlled input
  // at the first non-hex character — so a junk signature could turn a clean
  // rejection into an unhandled 500. These pin that every malformed shape is
  // still just a rejection.

  describe('HMAC comparison robustness', () => {
    const malformed: Array<[string, string]> = [
      ['non-hex characters', 'z'.repeat(128)],
      ['mixed hex and non-hex', `${'a'.repeat(120)}zzzzzzzz`],
      ['too short', 'abc123'],
      ['too long', 'a'.repeat(200)],
      ['empty string', ''],
      ['whitespace', '   '],
      ['a valid-length but wrong digest', 'b'.repeat(128)],
    ];

    it.each(malformed)('rejects %s without crashing', async (_label, badHmac) => {
      const orderId = await seedPendingOrder();
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
      const { payload } = buildPaymobCallback(56001, orderId, true, hmacSecret);
      const tampered = { ...payload, hmac: badHmac };

      // Specifically the mismatch error — NOT "Input buffers must have the same
      // byte length", which is what timingSafeEqual raises if fed unequal
      // buffers, and not a TypeError from hex truncation.
      await expect(
        adapter.verifyWebhookSignature(Buffer.from(JSON.stringify(tampered)), {})
      ).rejects.toThrow('Paymob webhook: HMAC signature mismatch');
    });

    it('still accepts a correct signature', async () => {
      const orderId = await seedPendingOrder();
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
      const { payload } = buildPaymobCallback(56002, orderId, true, hmacSecret);

      const event = await adapter.verifyWebhookSignature(
        Buffer.from(JSON.stringify(payload)), {}
      );
      expect(event.type).toBe('payment.succeeded');
    });

    it('accepts a correct signature regardless of case', async () => {
      // The adapter lowercases both sides before comparing; an uppercase digest
      // from the provider must still verify.
      const orderId = await seedPendingOrder();
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
      const { payload, hmac } = buildPaymobCallback(56003, orderId, true, hmacSecret);
      const upper = { ...payload, hmac: hmac.toUpperCase() };

      const event = await adapter.verifyWebhookSignature(
        Buffer.from(JSON.stringify(upper)), {}
      );
      expect(event.type).toBe('payment.succeeded');
    });

    it('rejects a signature differing only in its final character', async () => {
      // The case a short-circuiting compare distinguishes by timing.
      const orderId = await seedPendingOrder();
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
      const { payload, hmac } = buildPaymobCallback(56004, orderId, true, hmacSecret);
      const lastChar = hmac.slice(-1) === 'a' ? 'b' : 'a';
      const nearMiss = { ...payload, hmac: hmac.slice(0, -1) + lastChar };

      await expect(
        adapter.verifyWebhookSignature(Buffer.from(JSON.stringify(nearMiss)), {})
      ).rejects.toThrow('Paymob webhook: HMAC signature mismatch');
    });
  });

  // ── Webhook logging must not carry card or signature data ───────────────
  //
  // `verifyWebhookSignature` used to run an unconditional INFO log on EVERY
  // callback that dumped the whole field breakdown — `source_data.pan`, the
  // cardholder `owner`, the full concatenated HMAC preimage and the received
  // signature — straight into the persistent log file. It was debug
  // instrumentation that shipped. These pin that it cannot come back.

  describe('webhook logging hygiene', () => {
    const captured: string[] = [];
    let spies: jest.SpyInstance[] = [];

    beforeEach(() => {
      captured.length = 0;
      const capture = (_msg: unknown, meta?: unknown) =>
        // Serialise message AND metadata — the leak was entirely in the meta.
        captured.push(`${String(_msg)} ${JSON.stringify(meta ?? {})}`) as unknown as void;

      spies = (['info', 'warn', 'error', 'debug'] as const).map((level) =>
        jest.spyOn(logger, level).mockImplementation(capture as never)
      );
    });

    afterEach(() => {
      spies.forEach((s) => s.mockRestore());
    });

    it('logs nothing sensitive while accepting a valid callback', async () => {
      const orderId = await seedPendingOrder();
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
      const { payload, hmac } = buildPaymobCallback(55501, orderId, true, hmacSecret);

      await adapter.verifyWebhookSignature(Buffer.from(JSON.stringify(payload)), {});

      const log = captured.join('\n');
      expect(log).not.toContain('2346');   // source_data.pan
      expect(log).not.toContain(hmac);     // the signature
      expect(log).not.toContain('MasterCard');
      expect(log).not.toMatch(/preimage|concatenated/i);
    });

    it('logs a diagnostic on mismatch — field NAMES, never values', async () => {
      const orderId = await seedPendingOrder();
      const { payload } = buildPaymobCallback(55502, orderId, true, 'a-different-secret-entirely!!!!!');
      const tampered = { ...payload, hmac: 'deadbeef00000000' };

      await expect(
        adapter.verifyWebhookSignature(Buffer.from(JSON.stringify(tampered)), {})
      ).rejects.toThrow('HMAC signature mismatch');

      const log = captured.join('\n');
      // Useful: says what happened and against which transaction.
      expect(log).toContain('HMAC signature mismatch');
      expect(log).toContain('55502');
      // Not useful, and not ours to keep.
      expect(log).not.toContain('2346');
      expect(log).not.toContain('deadbeef00000000');
      expect(log).not.toContain('MasterCard');
    });

    it('names an empty field so a mismatch is diagnosable without values', async () => {
      const orderId = await seedPendingOrder();
      const hmacSecret = process.env.PAYMOB_HMAC_SECRET!;
      const { payload } = buildPaymobCallback(55503, orderId, true, hmacSecret);

      // Drop a field the signature covered — the realistic cause of a mismatch,
      // e.g. a wallet transaction that carries no card block.
      const obj = { ...(payload.obj as Record<string, unknown>) };
      delete obj.source_data;

      await expect(
        adapter.verifyWebhookSignature(
          Buffer.from(JSON.stringify({ ...payload, obj })), {}
        )
      ).rejects.toThrow('HMAC signature mismatch');

      const log = captured.join('\n');
      expect(log).toContain('source_data.pan');   // the NAME, to point at the fault
      expect(log).not.toContain('2346');          // never the value
    });
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
