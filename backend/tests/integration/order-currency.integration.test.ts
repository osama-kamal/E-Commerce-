/**
 * Regression tests for currency handling.
 *
 * Neither Store nor Order carried a currency. The Stripe path hardcoded 'usd'
 * and the Paymob path hardcoded 'egp', while the UI rendered "$" everywhere. A
 * customer paying via Paymob saw "$450.00" and was charged 450 EGP — roughly a
 * 50x discrepancy, in the merchant's favour or the customer's depending on
 * direction, and with no record of which currency an order was actually in.
 *
 * A store now declares its currency, each order records the currency it was
 * placed in, and the payment providers use/validate that value instead of a
 * hardcoded constant.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const paymentIntentsCreate = jest.fn();
jest.mock('../../src/config/stripe', () => ({
  stripe: {
    paymentIntents: { create: (...a: unknown[]) => paymentIntentsCreate(...a) },
    webhooks: { constructEvent: jest.fn() },
  },
}));

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrderConfirmationEmail: jest.fn(), sendOrderStatusEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

import { placeOrder } from '../../src/modules/orders/order.service';
import { createPaymentIntent } from '../../src/modules/payments/payment.service';
import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { Cart } from '../../src/modules/cart/cart.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';

let replSet: MongoMemoryReplSet;
let customerId: Types.ObjectId;

const CATEGORY_ID = new Types.ObjectId();
const SHIPPING = { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'CO' };

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' });

  await Promise.all([
    Order.deleteMany({}), Product.deleteMany({}), Cart.deleteMany({}),
    User.deleteMany({}), Store.deleteMany({}),
  ]);
});

async function makeStore(currency?: string) {
  const store = await Store.create({
    name: 'Cur Store', slug: `cur-${Math.random().toString(36).slice(2, 8)}`,
    ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
    ...(currency ? { currency } : {}),
  });
  const customer = await User.create({
    storeId: store._id, email: `c${Math.random()}@test.com`,
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerId = customer._id as Types.ObjectId;
  return store;
}

async function fillCart(store: InstanceType<typeof Store>, price = 100) {
  const product = await Product.create({
    storeId: store._id, name: 'W', description: 'd',
    price, stock: 50, categoryId: CATEGORY_ID,
  });
  await Cart.updateOne(
    { storeId: store._id, customerId },
    { $set: { items: [{ productId: product._id, quantity: 1, priceSnapshot: price }] } },
    { upsert: true }
  );
  return product;
}

// ── Store declares a currency ───────────────────────────────────────────────

describe('store currency', () => {
  it('defaults to USD when unspecified', async () => {
    const store = await makeStore();
    const fresh = await Store.findById(store._id).lean();
    expect(fresh!.currency).toBe('USD');
  });

  it('accepts an explicit ISO code', async () => {
    const store = await makeStore('EGP');
    const fresh = await Store.findById(store._id).lean();
    expect(fresh!.currency).toBe('EGP');
  });

  it('normalises to uppercase', async () => {
    const store = await makeStore('egp');
    const fresh = await Store.findById(store._id).lean();
    expect(fresh!.currency).toBe('EGP');
  });

  it('rejects a non-ISO code', async () => {
    await expect(
      Store.create({
        name: 'Bad', slug: 'bad-cur', ownerId: new Types.ObjectId(),
        isActive: true, currency: 'DOLLARS',
      })
    ).rejects.toThrow();
  });
});

// ── Orders record the currency they were placed in ──────────────────────────

describe('order currency', () => {
  it('inherits the store currency', async () => {
    const store = await makeStore('EGP');
    await fillCart(store);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    const fresh = await Order.findById(order._id).lean();
    expect(fresh!.currency).toBe('EGP');
  });

  it('defaults to USD for a store with no explicit currency', async () => {
    const store = await makeStore();
    await fillCart(store);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    const fresh = await Order.findById(order._id).lean();
    expect(fresh!.currency).toBe('USD');
  });

  it('is immutable history — changing the store later does not rewrite past orders', async () => {
    const store = await makeStore('USD');
    await fillCart(store);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await Store.updateOne({ _id: store._id }, { currency: 'EGP' });

    const fresh = await Order.findById(order._id).lean();
    expect(fresh!.currency).toBe('USD');
  });
});

// ── Stripe charges in the order's currency ──────────────────────────────────

describe('stripe payment intent', () => {
  it('uses the order currency instead of a hardcoded usd', async () => {
    const store = await makeStore('EGP');
    await fillCart(store, 100);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'online');

    await createPaymentIntent(
      order._id.toString(), customerId.toString(), store._id!.toString()
    );

    expect(paymentIntentsCreate).toHaveBeenCalledTimes(1);
    const [params] = paymentIntentsCreate.mock.calls[0] as [{ currency: string; amount: number }];
    expect(params.currency).toBe('egp');
    expect(params.amount).toBe(10000); // minor units
  });

  it('still uses usd for a USD store', async () => {
    const store = await makeStore('USD');
    await fillCart(store, 25);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'online');

    await createPaymentIntent(
      order._id.toString(), customerId.toString(), store._id!.toString()
    );

    const [params] = paymentIntentsCreate.mock.calls[0] as [{ currency: string; amount: number }];
    expect(params.currency).toBe('usd');
    expect(params.amount).toBe(2500);
  });
});

// ── The amount is scaled by the currency, not by a constant 100 ─────────────
//
// The currency was already carried correctly onto the intent; the AMOUNT was
// not. `Math.round(totalAmount * 100)` is right only for the two-decimal
// majority, so the same order was charged 100× on a zero-decimal currency and a
// tenth of its value on a three-decimal one — silently, with the intent still
// reporting the right currency code.

describe('stripe payment intent — minor-unit scaling', () => {
  const amountFor = () => {
    const [params] = paymentIntentsCreate.mock.calls[0] as [{ amount: number }];
    return params.amount;
  };

  it('does not multiply a zero-decimal currency', async () => {
    const store = await makeStore('JPY');
    await fillCart(store, 5000);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'online');

    await createPaymentIntent(
      order._id.toString(), customerId.toString(), store._id!.toString()
    );

    // ¥5,000 is 5000 minor units. The old conversion sent 500000 — ¥500,000.
    expect(amountFor()).toBe(5000);
  });

  it('multiplies a three-decimal currency by 1000', async () => {
    const store = await makeStore('KWD');
    await fillCart(store, 5);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'online');

    await createPaymentIntent(
      order._id.toString(), customerId.toString(), store._id!.toString()
    );

    // KWD 5.000 is 5000 fils. The old conversion sent 500 — KWD 0.500.
    expect(amountFor()).toBe(5000);
  });

  it('keeps the charged amount equal to the order total across scales', async () => {
    for (const [currency, price, expected] of [
      ['USD', 19.99, 1999],
      ['EGP', 250, 25000],
      ['JPY', 3200, 3200],
      ['KRW', 12500, 12500],
      ['BHD', 12.34, 12340],
    ] as Array<[string, number, number]>) {
      jest.clearAllMocks();
      paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' });

      const store = await makeStore(currency);
      await fillCart(store, price);
      const order = await placeOrder(
        store._id!.toString(), customerId.toString(), SHIPPING, 'online'
      );

      await createPaymentIntent(
        order._id.toString(), customerId.toString(), store._id!.toString()
      );

      const [params] = paymentIntentsCreate.mock.calls[0] as [{ amount: number; currency: string }];
      expect(params.currency).toBe(currency.toLowerCase());
      expect(params.amount).toBe(expected);
    }
  });

  it('prices three-decimal currencies to two places, which is what the gateway settles', async () => {
    // The money engine rounds every total to 2dp (round2 in checkout/money.ts),
    // so a BHD order priced at 12.345 is stored — and charged — as 12.35. The
    // customer pays exactly what the order says, so this is self-consistent
    // rather than a leak.
    //
    // It also happens to be required: Stripe settles three-decimal currencies
    // to two places and rejects a minor-unit amount that is not divisible by
    // 10. The 2dp total therefore lands on a value Stripe accepts by
    // construction. Merchants cannot price at fils granularity — a product
    // limitation, not a money defect.
    const store = await makeStore('BHD');
    await fillCart(store, 12.345);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'online');

    const stored = await Order.findById(order._id).lean();
    expect(stored!.totalAmount).toBe(12.35);

    await createPaymentIntent(
      order._id.toString(), customerId.toString(), store._id!.toString()
    );

    expect(amountFor()).toBe(12350);
    expect(amountFor() % 10).toBe(0);
  });
});

// ── The store currency allowlist ────────────────────────────────────────────

describe('supported currencies', () => {
  it('accepts a zero-decimal and a three-decimal currency', async () => {
    for (const code of ['JPY', 'KWD', 'ISK', 'OMR']) {
      const store = await makeStore(code);
      const fresh = await Store.findById(store._id).lean();
      expect(fresh!.currency).toBe(code);
    }
  });

  it('rejects a well-formed but unsupported code', async () => {
    // Shape alone is not enough: an unknown code would take the 2-decimal
    // default and be charged at a wrong-but-plausible scale.
    await expect(
      Store.create({
        name: 'Bad', slug: 'bad-cur-zzz', ownerId: new Types.ObjectId(),
        isActive: true, currency: 'ZZZ',
      })
    ).rejects.toThrow(/not a supported currency/);
  });
});
