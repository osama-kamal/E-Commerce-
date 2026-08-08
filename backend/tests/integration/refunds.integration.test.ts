/**
 * Refund issuance.
 *
 * The engine's arithmetic is covered by refund-math.test.ts. This file covers
 * what only a database can prove:
 *
 *   • the reservation saga — a provider failure must not leave an order looking
 *     refunded, and two concurrent refunds must not together exceed the order
 *   • the ledger and payment status stay consistent
 *   • restocking happens only after the money is confirmed on its way
 *   • cash-on-delivery, which never touched a gateway, is still recordable
 *   • refunds reduce reported revenue
 *
 * Before this existed, an admin's only reversal was moving the order to
 * `cancelled` — which restored stock and emailed the customer while their money
 * stayed taken.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';
import { Payment } from '../../src/modules/payments/payment.model';
import { Refund } from '../../src/modules/refunds/refund.model';
import { NET_REVENUE_EXPR } from '../../src/utils/revenue';
import * as refundService from '../../src/modules/refunds/refund.service';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendEmail: jest.fn(), sendWelcomeEmail: jest.fn(), verifyConnection: jest.fn(),
    sendOrderConfirmationEmail: jest.fn(), sendOrderStatusEmail: jest.fn(),
    sendPaymentReceiptEmail: jest.fn(),
  },
}));

// The gateway is mocked so the saga's failure path is exercisable. Each test
// controls what the provider does.
const refundPayment = jest.fn();
jest.mock('../../src/modules/payments/providers/payment-provider.factory', () => ({
  paymentProviderFactory: {
    get: () => ({ refundPayment: (...a: unknown[]) => refundPayment(...a) }),
  },
}));

let mongod: MongoMemoryServer;
const CATEGORY_ID = new Types.ObjectId();
const SHIPPING = { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'GB' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}), Product.deleteMany({}), User.deleteMany({}),
    Store.deleteMany({}), Payment.deleteMany({}), Refund.deleteMany({}),
  ]);
  refundPayment.mockReset();
  refundPayment.mockResolvedValue({ providerRefundId: 're_test', status: 'succeeded' });
});

async function makeStore() {
  return Store.create({
    name: 'S', slug: `s-${Math.random().toString(36).slice(2, 9)}`,
    ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active', trialEndsAt: null,
  });
}

/**
 * A paid order: 2 × £50 widgets, 20% exclusive VAT, £120 charged.
 * Stock starts at 10 so restocking is observable.
 */
async function makePaidOrder(
  store: InstanceType<typeof Store>,
  overrides: Record<string, unknown> = {}
) {
  const customer = await User.create({
    storeId: store._id, email: `c${Math.random()}@t.com`,
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  const product = await Product.create({
    storeId: store._id, name: 'Widget', description: 'd',
    price: 50, stock: 10, categoryId: CATEGORY_ID, isDeleted: false,
  });

  const order = await Order.create({
    storeId: store._id,
    customerId: customer._id,
    items: [{ productId: product._id, name: 'Widget', price: 50, quantity: 2 }],
    subtotal: 100,
    discountAmount: 0,
    shippingTotal: 0,
    taxTotal: 20,
    taxLines: [{ name: 'VAT', rate: 20, amount: 20, inclusive: false, appliesToShipping: false }],
    totalAmount: 120,
    refundedTotal: 0,
    currency: 'GBP',
    status: 'delivered',
    paymentStatus: 'paid',
    paymentMethod: 'online',
    shippingAddress: SHIPPING,
    ...overrides,
  });

  await Payment.create({
    orderId: order._id, customerId: customer._id,
    stripePaymentIntentId: 'pi_test', provider: 'stripe', providerPaymentId: 'pi_test',
    amount: 12000, currency: 'gbp', status: 'succeeded',
    stripeEventId: `evt_${Math.random()}`,
  });

  return { order, product, customer };
}

const admin = new Types.ObjectId();

// ── Happy paths ───────────────────────────────────────────────────────────────

describe('createRefund', () => {
  it('refunds a partial order and updates the ledger', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    const refund = await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { lines: [{ productId: order.items[0].productId.toString(), quantity: 1 }] },
      admin
    );

    expect(refund.status).toBe('succeeded');
    expect(refund.totalRefunded).toBe(60); // £50 goods + £10 VAT

    const after = await Order.findById(order._id).lean();
    expect(after!.refundedTotal).toBe(60);
    // The key property of the separate axis: still delivered, now part-refunded.
    expect(after!.paymentStatus).toBe('partially_refunded');
    expect(after!.status).toBe('delivered');
  });

  it('refunds everything and marks the order fully refunded', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    const refund = await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );

    expect(refund.totalRefunded).toBe(120);
    const after = await Order.findById(order._id).lean();
    expect(after!.paymentStatus).toBe('refunded');
    expect(after!.refundedTotal).toBe(120);
  });

  it('sends the gateway the amount in the smallest currency unit', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );

    expect(refundPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountInSmallestUnit: 12000, providerPaymentId: 'pi_test' })
    );
  });

  // The refund path had the same hardcoded `* 100` as the charge path, so it
  // returned 100× on a zero-decimal currency and a tenth on a three-decimal
  // one. A JPY refund of ¥12,000 was sent to the gateway as ¥1,200,000.
  it('scales the refund by the ORDER currency, not a constant 100', async () => {
    for (const [currency, totals, expectedMinor] of [
      ['JPY', { subtotal: 10000, taxTotal: 2000, totalAmount: 12000 }, 12000],
      ['KWD', { subtotal: 100, taxTotal: 20, totalAmount: 120 }, 120000],
      ['USD', { subtotal: 100, taxTotal: 20, totalAmount: 120 }, 12000],
    ] as Array<[string, Record<string, number>, number]>) {
      refundPayment.mockClear();

      const store = await makeStore();
      const { order } = await makePaidOrder(store, {
        currency,
        ...totals,
        items: [{ productId: new Types.ObjectId(), name: 'Widget', price: totals.subtotal, quantity: 1 }],
        taxLines: [{
          name: 'VAT', rate: 20, amount: totals.taxTotal,
          inclusive: false, appliesToShipping: false,
        }],
      });

      await refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true, restock: false }, admin
      );

      expect(refundPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amountInSmallestUnit: expectedMinor,
          currency: currency.toLowerCase(),
        })
      );
    }
  });

  it('restocks returned units by default', async () => {
    const store = await makeStore();
    const { order, product } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { lines: [{ productId: product._id.toString(), quantity: 2 }] },
      admin
    );

    const after = await Product.findById(product._id).lean();
    expect(after!.stock).toBe(12);
  });

  it('can refund without restocking, for damaged goods', async () => {
    const store = await makeStore();
    const { order, product } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { lines: [{ productId: product._id.toString(), quantity: 2 }], restock: false },
      admin
    );

    const after = await Product.findById(product._id).lean();
    expect(after!.stock).toBe(10);
  });
});

// ── The reservation saga ──────────────────────────────────────────────────────

describe('provider failure handling', () => {
  it('releases the reservation when the gateway rejects the refund', async () => {
    // The failure this guards: reserving first and then failing would leave the
    // order reading `partially_refunded` while the customer got nothing, and
    // the balance would be permanently unrefundable.
    const store = await makeStore();
    const { order } = await makePaidOrder(store);
    refundPayment.mockRejectedValue(new Error('card network declined'));

    await expect(
      refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true }, admin
      )
    ).rejects.toMatchObject({ statusCode: 502 });

    const after = await Order.findById(order._id).lean();
    expect(after!.refundedTotal).toBe(0);
    expect(after!.paymentStatus).toBe('paid'); // still fully refundable

    const record = await Refund.findOne({ orderId: order._id }).lean();
    expect(record!.status).toBe('failed');
    expect(record!.failureReason).toContain('declined');
  });

  it('does not restock when the gateway rejects the refund', async () => {
    // Restocking before the money is confirmed would put goods back on sale for
    // a refund that never happened.
    const store = await makeStore();
    const { order, product } = await makePaidOrder(store);
    refundPayment.mockRejectedValue(new Error('declined'));

    await expect(
      refundService.createRefund(
        store._id!.toString(), order._id.toString(),
        { lines: [{ productId: product._id.toString(), quantity: 2 }] },
        admin
      )
    ).rejects.toThrow();

    const after = await Product.findById(product._id).lean();
    expect(after!.stock).toBe(10);
  });

  it('lets a failed refund be retried', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    refundPayment.mockRejectedValueOnce(new Error('temporary gateway error'));
    await expect(
      refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true }, admin
      )
    ).rejects.toThrow();

    // The released reservation must make the full amount available again.
    const retry = await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );
    expect(retry.status).toBe('succeeded');
    expect(retry.totalRefunded).toBe(120);
  });

  it('treats a pending provider result as money in flight, not failure', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);
    refundPayment.mockResolvedValue({ providerRefundId: 're_x', status: 'pending' });

    const refund = await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );

    expect(refund.status).toBe('pending');
    // The ledger still reserves it — treating pending as nothing would let the
    // same money go out twice.
    const after = await Order.findById(order._id).lean();
    expect(after!.refundedTotal).toBe(120);
  });
});

// ── Over-refund protection ────────────────────────────────────────────────────

describe('over-refund protection', () => {
  it('refuses to refund more than the order total across several refunds', async () => {
    const store = await makeStore();
    const { order, product } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { lines: [{ productId: product._id.toString(), quantity: 2 }] },
      admin
    );

    await expect(
      refundService.createRefund(
        store._id!.toString(), order._id.toString(),
        { lines: [{ productId: product._id.toString(), quantity: 1 }] },
        admin
      )
    ).rejects.toMatchObject({ code: 'REFUND_INVALID' });
  });

  it('survives two concurrent full refunds without double-paying', async () => {
    // The reservation is a conditional update, so only one can win.
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    const results = await Promise.allSettled([
      refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true }, admin
      ),
      refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true }, admin
      ),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const after = await Order.findById(order._id).lean();
    expect(after!.refundedTotal).toBe(120);
    expect(refundPayment).toHaveBeenCalledTimes(1);
  });

  it('rejects refunding an unpaid order', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store, { paymentStatus: 'unpaid', status: 'pending' });

    await expect(
      refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true }, admin
      )
    ).rejects.toMatchObject({ code: 'REFUND_INVALID' });
  });

  it('rejects a second refund on a fully refunded order', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );

    await expect(
      refundService.createRefund(
        store._id!.toString(), order._id.toString(), { refundAll: true }, admin
      )
    ).rejects.toMatchObject({ code: 'REFUND_INVALID' });
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  it('returns the original refund when the same key is replayed', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    const first = await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { refundAll: true, idempotencyKey: 'refund-attempt-1' },
      admin
    );
    const replay = await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { refundAll: true, idempotencyKey: 'refund-attempt-1' },
      admin
    );

    expect(replay._id.toString()).toBe(first._id.toString());
    // The decisive assertion: the gateway was called once, so the money moved once.
    expect(refundPayment).toHaveBeenCalledTimes(1);

    const after = await Order.findById(order._id).lean();
    expect(after!.refundedTotal).toBe(120);
  });
});

// ── Cash on delivery ──────────────────────────────────────────────────────────

describe('cash on delivery', () => {
  it('records a manual refund without calling any gateway', async () => {
    const store = await makeStore();
    const { order } = await makePaidOrder(store, { paymentMethod: 'cod' });
    await Payment.deleteMany({ orderId: order._id });

    const refund = await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );

    expect(refund.provider).toBe('manual');
    expect(refund.status).toBe('succeeded');
    expect(refundPayment).not.toHaveBeenCalled();

    const after = await Order.findById(order._id).lean();
    expect(after!.paymentStatus).toBe('refunded');
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('tenant isolation', () => {
  it('refuses to refund another store\'s order', async () => {
    const store = await makeStore();
    const other = await makeStore();
    const { order } = await makePaidOrder(store);

    await expect(
      refundService.createRefund(
        other._id!.toString(), order._id.toString(), { refundAll: true }, admin
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── Preview ───────────────────────────────────────────────────────────────────

describe('previewRefund', () => {
  it('computes the same figures without moving money', async () => {
    const store = await makeStore();
    const { order, product } = await makePaidOrder(store);

    const preview = await refundService.previewRefund(
      store._id!.toString(), order._id.toString(),
      { lines: [{ productId: product._id.toString(), quantity: 1 }] }
    );

    expect(preview.totalRefunded).toBe(60);
    expect(preview.remainingRefundable).toBe(120);
    expect(refundPayment).not.toHaveBeenCalled();

    const after = await Order.findById(order._id).lean();
    expect(after!.refundedTotal).toBe(0);
  });
});

// ── Revenue reporting ─────────────────────────────────────────────────────────

describe('revenue', () => {
  it('reduces reported revenue by the refunded amount', async () => {
    const store = await makeStore();
    const { order, product } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(),
      { lines: [{ productId: product._id.toString(), quantity: 1 }] },
      admin
    );

    const [agg] = await Order.aggregate([
      { $match: { storeId: store._id } },
      {
        $group: {
          _id: null,
          revenue: { $sum: NET_REVENUE_EXPR },
          refunded: { $sum: { $ifNull: ['$refundedTotal', 0] } },
          refundedTax: { $sum: { $ifNull: ['$refundedTaxTotal', 0] } },
        },
      },
    ]);

    // £120 charged, £20 of it VAT → £100 earned net.
    // One of two units returned: £60 refunded, £10 of that VAT → £50 returned net.
    //
    // The subtraction is now INSIDE the expression. This test previously
    // asserted revenue of 100 and did `revenue − refunded` by hand, because
    // nothing in the product reduced revenue when money was returned — a
    // merchant could refund an entire order and watch the figure not move.
    expect(agg.refunded).toBe(60);
    expect(agg.refundedTax).toBe(10);
    expect(agg.revenue).toBe(50);
  });

  it('nets a FULL refund to zero rather than going negative', async () => {
    // `refundedTotal` is gross — it carries the tax back with the goods — so
    // subtracting it from a figure that already excluded tax would remove the
    // tax twice and report −20 on a fully refunded order. Both sides of the
    // subtraction must be on the same basis.
    const store = await makeStore();
    const { order } = await makePaidOrder(store);

    await refundService.createRefund(
      store._id!.toString(), order._id.toString(), { refundAll: true }, admin
    );

    const [agg] = await Order.aggregate([
      { $match: { storeId: store._id } },
      { $group: { _id: null, revenue: { $sum: NET_REVENUE_EXPR } } },
    ]);

    expect(agg.revenue).toBe(0);
  });
});
