/**
 * Regression tests for subscription plan enforcement.
 *
 * PLAN_LIMITS declared six limits; only `maxProducts` was ever read. The other
 * five existed purely as data, so a free-tier store received unlimited orders,
 * unlimited stores, custom domains and branding removal — every paid
 * differentiator except the product cap.
 *
 * Enforced here:
 *   maxOrdersPerMonth  — checkout refuses once the store's monthly quota is spent
 *   maxStores          — an owner cannot exceed their plan's store allowance
 *   customDomain       — only plans that include it may set one
 *   removeBranding     — surfaced to the client as a capability flag
 *
 * `apiAccess` is deliberately NOT covered: there is no API-key mechanism or
 * separate API surface in this codebase, so there is nothing to gate. It needs
 * that feature to exist first.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { placeOrder } from '../../src/modules/orders/order.service';
import {
  createStore,
  updateStore,
  adminUpdateStore,
  getPlanCapabilities,
  assertAssignableCustomDomain,
} from '../../src/modules/stores/store.service';
import { config } from '../../src/config/index';
import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { Cart } from '../../src/modules/cart/cart.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrderConfirmationEmail: jest.fn(), sendOrderStatusEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let replSet: MongoMemoryReplSet;
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
  await Promise.all([
    Order.deleteMany({}), Product.deleteMany({}), Cart.deleteMany({}),
    User.deleteMany({}), Store.deleteMany({}),
  ]);
});

async function makeStore(plan: string, ownerId = new Types.ObjectId()) {
  return Store.create({
    name: `S-${Math.random().toString(36).slice(2, 7)}`,
    slug: `s-${Math.random().toString(36).slice(2, 9)}`,
    ownerId, isActive: true,
    subscriptionPlan: plan, subscriptionStatus: 'active',
  });
}

async function makeCustomer(store: InstanceType<typeof Store>) {
  const u = await User.create({
    storeId: store._id, email: `c${Math.random()}@t.com`,
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  return u._id as Types.ObjectId;
}

async function fillCart(store: InstanceType<typeof Store>, customerId: Types.ObjectId, qty = 1) {
  const p = await Product.create({
    storeId: store._id, name: 'W', description: 'd',
    price: 10, stock: 500, categoryId: CATEGORY_ID,
  });
  await Cart.updateOne(
    { storeId: store._id, customerId },
    { $set: { items: [{ productId: p._id, quantity: qty, priceSnapshot: 10 }] } },
    { upsert: true }
  );
}

/** Seeds `n` orders inside the current calendar month. */
async function seedOrdersThisMonth(store: InstanceType<typeof Store>, n: number, status = 'pending') {
  const now = new Date();
  await Order.insertMany(
    Array.from({ length: n }, () => ({
      storeId: store._id,
      customerId: new Types.ObjectId(),
      items: [{ productId: new Types.ObjectId(), name: 'x', price: 10, quantity: 1 }],
      totalAmount: 10,
      currency: 'USD',
      status,
      paymentMethod: 'cod',
      shippingAddress: SHIPPING,
      createdAt: new Date(now.getFullYear(), now.getMonth(), 1, 12, 0, 0),
    }))
  );
}

// ── maxOrdersPerMonth ───────────────────────────────────────────────────────

describe('maxOrdersPerMonth', () => {
  it('refuses a new order once a free store has spent its monthly quota', async () => {
    const store = await makeStore('free'); // limit 50
    const customerId = await makeCustomer(store);
    await seedOrdersThisMonth(store, 50);
    await fillCart(store, customerId);

    await expect(
      placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod')
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });
  });

  it('allows an order while under quota', async () => {
    const store = await makeStore('free');
    const customerId = await makeCustomer(store);
    await seedOrdersThisMonth(store, 10);
    await fillCart(store, customerId);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    expect(order._id).toBeDefined();
  });

  it('does not count cancelled orders against the quota', async () => {
    const store = await makeStore('free');
    const customerId = await makeCustomer(store);
    await seedOrdersThisMonth(store, 60, 'cancelled');
    await fillCart(store, customerId);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    expect(order._id).toBeDefined();
  });

  it('does not count orders from a previous month', async () => {
    const store = await makeStore('free');
    const customerId = await makeCustomer(store);

    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    await Order.insertMany(
      Array.from({ length: 60 }, () => ({
        storeId: store._id, customerId: new Types.ObjectId(),
        items: [{ productId: new Types.ObjectId(), name: 'x', price: 10, quantity: 1 }],
        totalAmount: 10, currency: 'USD', status: 'delivered', paymentMethod: 'cod',
        shippingAddress: SHIPPING, createdAt: lastMonth,
      }))
    );
    await fillCart(store, customerId);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    expect(order._id).toBeDefined();
  });

  it('does not count another store orders', async () => {
    const store = await makeStore('free');
    const other = await makeStore('free');
    const customerId = await makeCustomer(store);
    await seedOrdersThisMonth(other, 60);
    await fillCart(store, customerId);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    expect(order._id).toBeDefined();
  });

  it('treats -1 as unlimited for pro', async () => {
    const store = await makeStore('pro'); // maxOrdersPerMonth: -1
    const customerId = await makeCustomer(store);
    await seedOrdersThisMonth(store, 600);
    await fillCart(store, customerId);

    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    expect(order._id).toBeDefined();
  });
});

// ── maxStores ───────────────────────────────────────────────────────────────

describe('maxStores', () => {
  it('refuses a second store for a free-plan owner', async () => {
    const ownerId = new Types.ObjectId();
    await makeStore('free', ownerId); // free allows 1

    await expect(
      createStore({ name: 'Second', slug: 'second-store', ownerId: ownerId.toString() })
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });
  });

  it('allows the first store for a brand-new owner', async () => {
    const ownerId = new Types.ObjectId();

    const store = await createStore({
      name: 'First', slug: 'first-store', ownerId: ownerId.toString(),
    });

    expect(store.slug).toBe('first-store');
  });

  it('allows up to the starter allowance', async () => {
    const ownerId = new Types.ObjectId();
    await makeStore('starter', ownerId); // starter allows 3
    await makeStore('starter', ownerId);

    const third = await createStore({
      name: 'Third', slug: 'third-store', ownerId: ownerId.toString(),
    });
    expect(third.slug).toBe('third-store');
  });

  it('refuses beyond the starter allowance', async () => {
    const ownerId = new Types.ObjectId();
    await makeStore('starter', ownerId);
    await makeStore('starter', ownerId);
    await makeStore('starter', ownerId);

    await expect(
      createStore({ name: 'Fourth', slug: 'fourth-store', ownerId: ownerId.toString() })
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });
  });

  it('treats -1 as unlimited for enterprise', async () => {
    const ownerId = new Types.ObjectId();
    for (let i = 0; i < 12; i++) await makeStore('enterprise', ownerId);

    const extra = await createStore({
      name: 'Extra', slug: 'extra-store', ownerId: ownerId.toString(),
    });
    expect(extra.slug).toBe('extra-store');
  });

  it('counts only stores owned by that user', async () => {
    const ownerId = new Types.ObjectId();
    await makeStore('free', new Types.ObjectId());
    await makeStore('free', new Types.ObjectId());

    const store = await createStore({
      name: 'Mine', slug: 'mine-store', ownerId: ownerId.toString(),
    });
    expect(store.slug).toBe('mine-store');
  });
});

// ── customDomain ────────────────────────────────────────────────────────────

describe('customDomain', () => {
  // The owner path no longer accepts this field at all. `resolveStoreByHost`
  // matches customDomain ahead of everything else, so a self-serve write was
  // enough for one tenant to capture the platform's own hostname.
  it('refuses a custom domain from the store owner, whatever the plan', async () => {
    for (const plan of ['free', 'starter', 'pro', 'enterprise'] as const) {
      const ownerId = new Types.ObjectId();
      const store = await makeStore(plan, ownerId);

      await expect(
        updateStore(store._id!.toString(), ownerId.toString(), { customDomain: 'shop.example.com' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

      const after = await Store.findById(store._id).lean();
      expect(after!.customDomain).toBeUndefined();
    }
  });

  it('lets a super-admin connect a domain for a store on a paid plan', async () => {
    const store = await makeStore('starter', new Types.ObjectId());

    const updated = await adminUpdateStore(store._id!.toString(), {
      customDomain: 'shop.example.com',
    });

    expect(updated.customDomain).toBe('shop.example.com');
  });

  it('keeps the paid-capability boundary on the admin path', async () => {
    const store = await makeStore('free', new Types.ObjectId());

    await expect(
      adminUpdateStore(store._id!.toString(), { customDomain: 'shop.example.com' })
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_EXCEEDED' });
  });

  it('refuses a domain already connected to another store', async () => {
    const first = await makeStore('pro', new Types.ObjectId());
    const second = await makeStore('pro', new Types.ObjectId());

    await adminUpdateStore(first._id!.toString(), { customDomain: 'taken.example.com' });

    await expect(
      adminUpdateStore(second._id!.toString(), { customDomain: 'taken.example.com' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT' });
  });

  it('still allows other edits on the free plan', async () => {
    const ownerId = new Types.ObjectId();
    const store = await makeStore('free', ownerId);

    const updated = await updateStore(store._id!.toString(), ownerId.toString(), { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
  });
});

// ── Platform-hostname guard ─────────────────────────────────────────────────
//
// The reserved-subdomain list in resolveStoreByHost guards the SUBDOMAIN branch
// only, and custom domains are matched before it ever runs. These pin the
// separate guard that closes that gap.

describe('assertAssignableCustomDomain', () => {
  const platformHost = new URL(config.FRONTEND_URL).hostname;

  it('refuses the platform hostname itself', () => {
    expect(() => assertAssignableCustomDomain(platformHost)).toThrow(/platform hostname/i);
  });

  it('refuses a subdomain of the platform, covering api/admin without listing them', () => {
    for (const label of ['api', 'admin', 'www', 'anything']) {
      expect(() => assertAssignableCustomDomain(`${label}.${platformHost}`)).toThrow(
        /platform hostname/i
      );
    }
  });

  it('refuses loopback names', () => {
    expect(() => assertAssignableCustomDomain('localhost')).toThrow(/platform hostname/i);
    expect(() => assertAssignableCustomDomain('127.0.0.1')).toThrow(/platform hostname/i);
  });

  it('is not fooled by case or surrounding whitespace', () => {
    expect(() => assertAssignableCustomDomain(`  ${platformHost.toUpperCase()}  `)).toThrow(
      /platform hostname/i
    );
  });

  it('does not refuse a hostname that merely ends with similar text', () => {
    expect(assertAssignableCustomDomain(`not${platformHost}`)).toBe(`not${platformHost}`);
  });

  it('accepts and normalises a genuine third-party domain', () => {
    expect(assertAssignableCustomDomain('  Shop.Acme.COM ')).toBe('shop.acme.com');
  });
});

// ── capability surface for the client ───────────────────────────────────────

describe('getPlanCapabilities', () => {
  it('reports branding as removable only on paid tiers', () => {
    expect(getPlanCapabilities('free').removeBranding).toBe(false);
    expect(getPlanCapabilities('starter').removeBranding).toBe(false);
    expect(getPlanCapabilities('pro').removeBranding).toBe(true);
    expect(getPlanCapabilities('enterprise').removeBranding).toBe(true);
  });

  it('reports customDomain availability per tier', () => {
    expect(getPlanCapabilities('free').customDomain).toBe(false);
    expect(getPlanCapabilities('pro').customDomain).toBe(true);
  });

  it('falls back to the free plan for an unknown value', () => {
    expect(getPlanCapabilities('nonsense').removeBranding).toBe(false);
  });
});
