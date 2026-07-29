/**
 * Regression tests for the order idempotency index.
 *
 * The model declared:
 *
 *   orderSchema.index(
 *     { storeId: 1, customerId: 1, idempotencyKey: 1 },
 *     { unique: true, sparse: true }   // "sparse so null values are excluded"
 *   );
 *
 * That comment is wrong for a COMPOUND index. MongoDB includes a document in a
 * compound sparse index when AT LEAST ONE indexed field is present — and
 * storeId/customerId are always present. So every order was indexed, key-less
 * orders all indexed as `idempotencyKey: null`, and a customer could place only
 * ONE order per store without supplying a key. The second failed with E11000.
 *
 * The web checkout always sends a key so it was unaffected, but any other
 * client (mobile, API integration, seed script, admin-placed order) hit a hard
 * wall after a single order.
 *
 * A partialFilterExpression is the correct construct: index only documents where
 * idempotencyKey is actually a string.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { placeOrder } from '../../src/modules/orders/order.service';
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
let store: InstanceType<typeof Store>;
let otherStore: InstanceType<typeof Store>;
let customerId: Types.ObjectId;
let otherCustomerId: Types.ObjectId;

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
  // Rebuild indexes from the schema so the test exercises the real definition.
  await Order.collection.dropIndexes().catch(() => { /* fresh collection */ });
  await Order.syncIndexes();

  store = await Store.create({
    name: 'Idem Store', slug: 'idem-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  otherStore = await Store.create({
    name: 'Other', slug: 'idem-other', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });

  const c1 = await User.create({
    storeId: store._id, email: 'i1@test.com', passwordHash: 'x',
    role: 'customer', isActive: true,
  });
  const c2 = await User.create({
    storeId: store._id, email: 'i2@test.com', passwordHash: 'x',
    role: 'customer', isActive: true,
  });
  customerId = c1._id as Types.ObjectId;
  otherCustomerId = c2._id as Types.ObjectId;
});

/**
 * Seeds a cart.
 *
 * `qty` varies the order total on purpose: placeOrder has a 5-minute
 * duplicate-order guard keyed on (store, customer, status, totalAmount), so
 * two same-priced pending orders would be rejected by THAT rule and mask the
 * index behaviour under test here.
 */
async function fillCart(
  targetStore: InstanceType<typeof Store>,
  who: Types.ObjectId,
  qty = 1
) {
  const product = await Product.create({
    storeId: targetStore._id, name: 'W', description: 'd',
    price: 10, stock: 100, categoryId: CATEGORY_ID,
  });
  await Cart.updateOne(
    { storeId: targetStore._id, customerId: who },
    { $set: { items: [{ productId: product._id, quantity: qty, priceSnapshot: 10 }] } },
    { upsert: true }
  );
  return product;
}

// ── The bug ─────────────────────────────────────────────────────────────────

describe('orders without an idempotency key', () => {
  it('lets the same customer place two orders in one store', async () => {
    await fillCart(store, customerId, 1);
    const first = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await fillCart(store, customerId, 2);
    const second = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    expect(first._id.toString()).not.toBe(second._id.toString());
    expect(await Order.countDocuments({ customerId })).toBe(2);
  });

  it('lets the same customer place many orders', async () => {
    for (let i = 1; i <= 5; i++) {
      await fillCart(store, customerId, i);
      await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    }
    expect(await Order.countDocuments({ customerId })).toBe(5);
  });

  it('does not interfere across customers', async () => {
    await fillCart(store, customerId);
    await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await fillCart(store, otherCustomerId);
    await placeOrder(store._id!.toString(), otherCustomerId.toString(), SHIPPING, 'cod');

    expect(await Order.countDocuments({})).toBe(2);
  });
});

// ── Idempotency itself must still work ──────────────────────────────────────

describe('idempotency key behaviour is preserved', () => {
  it('returns the existing order when the same key is replayed', async () => {
    await fillCart(store, customerId);
    const first = await placeOrder(
      store._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'key-1'
    );

    await fillCart(store, customerId);
    const replay = await placeOrder(
      store._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'key-1'
    );

    expect(replay._id.toString()).toBe(first._id.toString());
    expect(await Order.countDocuments({})).toBe(1);
  });

  it('treats distinct keys as distinct orders', async () => {
    await fillCart(store, customerId, 1);
    await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'key-a');
    await fillCart(store, customerId, 3);
    await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'key-b');

    expect(await Order.countDocuments({})).toBe(2);
  });

  it('scopes keys per store', async () => {
    await fillCart(store, customerId);
    await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'shared');

    await fillCart(otherStore, customerId);
    await placeOrder(otherStore._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'shared');

    expect(await Order.countDocuments({})).toBe(2);
  });

  it('scopes keys per customer', async () => {
    await fillCart(store, customerId);
    await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod', undefined, 'shared');

    await fillCart(store, otherCustomerId);
    await placeOrder(store._id!.toString(), otherCustomerId.toString(), SHIPPING, 'cod', undefined, 'shared');

    expect(await Order.countDocuments({})).toBe(2);
  });
});

// ── Index shape ─────────────────────────────────────────────────────────────

describe('index definition', () => {
  it('uses a partial filter rather than sparse for the unique constraint', async () => {
    const indexes = await Order.collection.indexes();
    const idem = indexes.find((i) => i.name === 'storeId_1_customerId_1_idempotencyKey_1');

    expect(idem).toBeDefined();
    expect(idem!.unique).toBe(true);
    expect(idem!.partialFilterExpression).toBeDefined();
    expect(idem!.sparse).toBeFalsy();
  });
});
