/**
 * Tax and shipping at checkout.
 *
 * The money engine has its own unit tests (money-engine.test.ts). This file
 * covers the things only a real order can prove:
 *
 *   • the breakdown is PERSISTED, so an invoice reprinted later is truthful
 *   • `totalAmount` is still the charged figure, so Stripe/Paymob — which read
 *     that field and were not modified — bill the right amount
 *   • the client cannot influence what shipping costs
 *   • a rate cannot be used outside the zone it belongs to
 *   • legacy orders with no breakdown still aggregate as they always did
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { placeOrder } from '../../src/modules/orders/order.service';
import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { Cart } from '../../src/modules/cart/cart.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';
import { ShippingZone, ShippingRate } from '../../src/modules/shipping/shipping.model';
import { TaxRate } from '../../src/modules/tax/tax.model';
import { NET_REVENUE_EXPR } from '../../src/utils/revenue';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrderConfirmationEmail: jest.fn(), sendOrderStatusEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let replSet: MongoMemoryReplSet;
const CATEGORY_ID = new Types.ObjectId();

const UK = { line1: '1 St', city: 'London', state: 'ENG', postalCode: 'E1', country: 'GB' };
const US = { line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}), Product.deleteMany({}), Cart.deleteMany({}),
    User.deleteMany({}), Store.deleteMany({}),
    ShippingZone.deleteMany({}), ShippingRate.deleteMany({}), TaxRate.deleteMany({}),
  ]);
});

async function makeStore(pricesIncludeTax = false) {
  return Store.create({
    name: `S-${Math.random().toString(36).slice(2, 7)}`,
    slug: `s-${Math.random().toString(36).slice(2, 9)}`,
    ownerId: new Types.ObjectId(),
    isActive: true,
    subscriptionPlan: 'pro',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    pricesIncludeTax,
  });
}

async function makeCustomer(store: InstanceType<typeof Store>) {
  const u = await User.create({
    storeId: store._id, email: `c${Math.random()}@t.com`,
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  return u._id as Types.ObjectId;
}

/** Seeds a cart holding one product at `price` × `qty`. */
async function fillCart(
  store: InstanceType<typeof Store>,
  customerId: Types.ObjectId,
  price = 100,
  qty = 1
) {
  const product = await Product.create({
    storeId: store._id, name: 'Widget', description: 'd',
    price, stock: 999, categoryId: CATEGORY_ID, isDeleted: false,
  });
  await Cart.create({
    storeId: store._id, customerId,
    items: [{ productId: product._id, quantity: qty, priceSnapshot: price, selectedSize: null }],
  });
  return product;
}

async function makeZone(store: InstanceType<typeof Store>, countries: string[], name = 'Zone') {
  return ShippingZone.create({ storeId: store._id, name, countries, isActive: true });
}

async function makeFlatRate(
  store: InstanceType<typeof Store>,
  zone: InstanceType<typeof ShippingZone>,
  amount: number,
  name = 'Standard'
) {
  return ShippingRate.create({
    storeId: store._id, zoneId: zone._id, name,
    type: 'flat', flatAmount: amount, isActive: true,
  });
}

// ── Persistence and charging ──────────────────────────────────────────────────

describe('order money breakdown', () => {
  it('persists the full breakdown and charges subtotal + shipping + tax', async () => {
    const store = await makeStore(false); // tax-exclusive
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 100, 1);

    const zone = await makeZone(store, ['GB']);
    const rate = await makeFlatRate(store, zone, 5);
    await TaxRate.create({
      storeId: store._id, name: 'VAT', rate: 20, country: 'GB',
      appliesToShipping: true, isActive: true,
    });

    const order = await placeOrder(
      store._id!.toString(), customerId.toString(), UK, 'cod',
      undefined, undefined, rate._id.toString()
    );

    expect(order.subtotal).toBe(100);
    expect(order.shippingTotal).toBe(5);
    expect(order.taxTotal).toBe(21);      // (100 + 5) * 20%
    expect(order.totalAmount).toBe(126);  // 100 + 5 + 21

    // `totalAmount` is what payment.service multiplies by 100 for Stripe. If
    // this ever stops being the grand total, every card charge silently
    // undercollects by the tax and postage.
    const stored = await Order.findById((order as any)._id).lean();
    expect(stored!.totalAmount).toBe(126);
    expect(stored!.taxLines).toHaveLength(1);
    expect(stored!.taxLines[0]).toMatchObject({ name: 'VAT', rate: 20, inclusive: false });
    expect(stored!.shippingMethod).toMatchObject({ name: 'Standard', amount: 5 });
  });

  it('does NOT add tax on top when the store prices tax-inclusively', async () => {
    const store = await makeStore(true); // tax-inclusive
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 120, 1);

    const zone = await makeZone(store, ['GB']);
    const rate = await makeFlatRate(store, zone, 0, 'Free delivery');
    await TaxRate.create({
      storeId: store._id, name: 'VAT', rate: 20, country: 'GB',
      appliesToShipping: true, isActive: true,
    });

    const order = await placeOrder(
      store._id!.toString(), customerId.toString(), UK, 'cod',
      undefined, undefined, rate._id.toString()
    );

    // The customer pays exactly the listed price; the VAT was always inside it.
    expect(order.totalAmount).toBe(120);
    expect(order.taxTotal).toBe(20); // 120 * 20/120
    expect(order.taxLines[0].inclusive).toBe(true);
  });

  it('charges no tax when the merchant has configured no rates', async () => {
    // The pre-existing behaviour for every store that has not set tax up.
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 50, 2);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), UK, 'cod');

    expect(order.taxTotal).toBe(0);
    expect(order.shippingTotal).toBe(0);
    expect(order.totalAmount).toBe(100);
  });
});

// ── The client cannot set its own postage ─────────────────────────────────────

describe('shipping cannot be manipulated by the client', () => {
  it('re-derives the amount from the rate record, ignoring anything sent', async () => {
    // placeOrder accepts only a rate ID — there is no amount parameter to
    // tamper with. This pins that the stored figure comes from the rate.
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 10, 1);

    const zone = await makeZone(store, ['GB']);
    const rate = await makeFlatRate(store, zone, 25, 'Express');

    const order = await placeOrder(
      store._id!.toString(), customerId.toString(), UK, 'cod',
      undefined, undefined, rate._id.toString()
    );

    expect(order.shippingTotal).toBe(25);
    expect(order.totalAmount).toBe(35);
  });

  it('rejects a rate belonging to a zone that does not serve the address', async () => {
    // Without this check a shopper could read a cheap domestic rate's ID from
    // the quote endpoint and reuse it on an international address.
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 10, 1);

    const ukZone = await makeZone(store, ['GB'], 'UK');
    const cheapUkRate = await makeFlatRate(store, ukZone, 1, 'UK Post');

    // The US zone needs a rate of its own, otherwise the destination resolves
    // to "no options" and the DESTINATION_NOT_SERVED guard fires first — the
    // assertion would still pass on the status code while never exercising the
    // wrong-zone check this test exists for.
    const usZone = await makeZone(store, ['US'], 'USA');
    await makeFlatRate(store, usZone, 20, 'US Ground');

    await expect(
      placeOrder(
        store._id!.toString(), customerId.toString(), US, 'cod',
        undefined, undefined, cheapUkRate._id.toString()
      )
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects another tenant\'s shipping rate', async () => {
    const store = await makeStore(false);
    const other = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 10, 1);

    const otherZone = await makeZone(other, ['GB']);
    const otherRate = await makeFlatRate(other, otherZone, 0, 'Free');

    await expect(
      placeOrder(
        store._id!.toString(), customerId.toString(), UK, 'cod',
        undefined, undefined, otherRate._id.toString()
      )
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── Delivery method is mandatory once shipping is configured ──────────────────
// Without these guards the whole feature is opt-out: omitting `shippingRateId`
// would yield free delivery no matter what the merchant configured.

describe('delivery method requirement', () => {
  it('refuses an order with no method chosen when options exist', async () => {
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 20, 1);

    const zone = await makeZone(store, ['GB']);
    await makeFlatRate(store, zone, 5);

    await expect(
      placeOrder(store._id!.toString(), customerId.toString(), UK, 'cod')
    ).rejects.toMatchObject({ statusCode: 400, code: 'SHIPPING_METHOD_REQUIRED' });
  });

  it('refuses an address no configured zone serves', async () => {
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 20, 1);

    // Ships to the UK only — a US address must be refused, not shipped free.
    const zone = await makeZone(store, ['GB']);
    await makeFlatRate(store, zone, 5);

    await expect(
      placeOrder(store._id!.toString(), customerId.toString(), US, 'cod')
    ).rejects.toMatchObject({ statusCode: 400, code: 'DESTINATION_NOT_SERVED' });
  });

  it('still accepts orders from a store that has configured no zones at all', async () => {
    // Backwards compatibility: every store predating this feature is in this
    // state and must keep checking out exactly as before.
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 20, 1);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), US, 'cod');

    expect(order.shippingTotal).toBe(0);
    expect(order.totalAmount).toBe(20);
  });
});

// ── Free-over threshold ───────────────────────────────────────────────────────

describe('free_over rates', () => {
  it('charges below the threshold and is free at or above it', async () => {
    const store = await makeStore(false);
    const zone = await makeZone(store, ['GB']);
    const rate = await ShippingRate.create({
      storeId: store._id, zoneId: zone._id, name: 'Standard',
      type: 'free_over', flatAmount: 4.99, freeOverThreshold: 50, isActive: true,
    });

    // £30 basket — under the threshold, so postage is charged.
    const c1 = await makeCustomer(store);
    await fillCart(store, c1, 30, 1);
    const under = await placeOrder(
      store._id!.toString(), c1.toString(), UK, 'cod', undefined, undefined, rate._id.toString()
    );
    expect(under.shippingTotal).toBe(4.99);

    // £60 basket — over the threshold, so delivery is free.
    const c2 = await makeCustomer(store);
    await fillCart(store, c2, 60, 1);
    const over = await placeOrder(
      store._id!.toString(), c2.toString(), UK, 'cod', undefined, undefined, rate._id.toString()
    );
    expect(over.shippingTotal).toBe(0);
    expect(over.totalAmount).toBe(60);
  });
});

// ── Zone matching ─────────────────────────────────────────────────────────────

describe('zone matching', () => {
  it('prefers an explicitly listed country over the rest-of-world catch-all', async () => {
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 10, 1);

    const row = await makeZone(store, ['*'], 'Rest of world');
    await makeFlatRate(store, row, 30, 'International');
    const uk = await makeZone(store, ['GB'], 'UK');
    const ukRate = await makeFlatRate(store, uk, 3, 'UK Standard');

    const order = await placeOrder(
      store._id!.toString(), customerId.toString(), UK, 'cod',
      undefined, undefined, ukRate._id.toString()
    );
    expect(order.shippingTotal).toBe(3);
  });
});

// ── Revenue reporting ─────────────────────────────────────────────────────────

describe('net revenue reporting', () => {
  it('excludes tax but retains shipping', async () => {
    const store = await makeStore(false);
    const customerId = await makeCustomer(store);
    await fillCart(store, customerId, 100, 1);

    const zone = await makeZone(store, ['GB']);
    const rate = await makeFlatRate(store, zone, 10);
    await TaxRate.create({
      storeId: store._id, name: 'VAT', rate: 20, country: 'GB',
      appliesToShipping: false, isActive: true,
    });

    const order = await placeOrder(
      store._id!.toString(), customerId.toString(), UK, 'cod',
      undefined, undefined, rate._id.toString()
    );
    await Order.updateOne({ _id: (order as any)._id }, { status: 'delivered' });

    const [agg] = await Order.aggregate([
      { $match: { storeId: store._id } },
      { $group: { _id: null, revenue: { $sum: NET_REVENUE_EXPR } } },
    ]);

    // Charged 130 (100 goods + 10 postage + 20 VAT). Revenue is 110 — the VAT
    // is a liability owed to HMRC, never income.
    expect(order.totalAmount).toBe(130);
    expect(agg.revenue).toBe(110);
  });

  it('reports legacy orders with no breakdown exactly as before', async () => {
    // Adopting NET_REVENUE_EXPR must not move a single historical figure.
    const store = await makeStore(false);
    await Order.collection.insertOne({
      storeId: store._id,
      customerId: new Types.ObjectId(),
      items: [{ productId: new Types.ObjectId(), name: 'Old', price: 40, quantity: 1 }],
      totalAmount: 40,
      discountAmount: 0,
      currency: 'USD',
      status: 'delivered',
      paymentMethod: 'cod',
      shippingAddress: UK,
      createdAt: new Date(),
      updatedAt: new Date(),
      // deliberately no subtotal / taxTotal — this is a pre-migration document
    });

    const [agg] = await Order.aggregate([
      { $match: { storeId: store._id } },
      { $group: { _id: null, revenue: { $sum: NET_REVENUE_EXPR } } },
    ]);

    expect(agg.revenue).toBe(40);
  });
});
