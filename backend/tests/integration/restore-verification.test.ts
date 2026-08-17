/**
 * The restore verifier must FAIL on a broken restore.
 *
 * A verification script that only ever prints ✅ is worse than none: it converts
 * "we did not check" into "we checked and it was fine". So these tests
 * deliberately break a restored database in each of the ways a real restore
 * breaks, and assert the verifier catches it.
 *
 * Each case corresponds to something that actually happens:
 *   • `mongorestore --noIndexRestore` → unique indexes silently absent
 *   • restoring a subset of collections → orphaned foreign keys
 *   • interleaved snapshots / partial oplog replay → broken money invariants
 *   • pointing at the wrong (empty) cluster → zero documents
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { verifyRestore } from '../../src/scripts/verify-restore';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';

let mongod: MongoMemoryServer;
let logSpy: jest.SpyInstance;

const SHIPPING = { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'CO' };
const CATEGORY_ID = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Silence the verifier's console output; the assertions are on its return.
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  await Promise.all([
    Store.deleteMany({}), User.deleteMany({}), Order.deleteMany({}), Product.deleteMany({}),
  ]);
});

afterEach(() => logSpy.mockRestore());

/** A minimal but internally consistent "restored" database. */
async function seedHealthyRestore() {
  await Promise.all([Store.syncIndexes(), User.syncIndexes()]);

  const ownerId = new Types.ObjectId();
  const store = await Store.create({
    name: 'Restored Store', slug: 'restored-store', ownerId,
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  await User.create({
    _id: ownerId, storeId: store._id, email: 'owner@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  const customer = await User.create({
    storeId: store._id, email: 'cust@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  const product = await Product.create({
    storeId: store._id, name: 'W', description: 'd',
    price: 50, stock: 10, categoryId: CATEGORY_ID,
  });
  const order = await Order.create({
    storeId: store._id, customerId: customer._id,
    items: [{ productId: product._id, name: 'W', price: 50, quantity: 2 }],
    subtotal: 100, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
    totalAmount: 100, refundedTotal: 0, currency: 'USD',
    status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
    shippingAddress: SHIPPING,
  });

  return { store, customer, product, order };
}

describe('a healthy restore passes', () => {
  it('returns true when the data and indexes are intact', async () => {
    await seedHealthyRestore();
    await expect(verifyRestore()).resolves.toBe(true);
  });
});

describe('a broken restore fails', () => {
  it('catches an empty target — the wrong-snapshot case', async () => {
    // Nothing seeded: the classic "restore completed" against an empty cluster.
    await expect(verifyRestore()).resolves.toBe(false);
  });

  it('catches a missing unique index — the --noIndexRestore case', async () => {
    await seedHealthyRestore();

    // Data intact, tenant-isolating index gone. The app would run and silently
    // let two tenants collide on {storeId, email}.
    await mongoose.connection.db!.collection('users').dropIndex('storeId_1_email_1');

    await expect(verifyRestore()).resolves.toBe(false);
  });

  it('catches an order whose store was not restored', async () => {
    const { order } = await seedHealthyRestore();
    await Order.updateOne({ _id: order._id }, { storeId: new Types.ObjectId() });

    await expect(verifyRestore()).resolves.toBe(false);
  });

  it('catches a store whose owner was not restored', async () => {
    const { store } = await seedHealthyRestore();
    await Store.updateOne({ _id: store._id }, { ownerId: new Types.ObjectId() });

    await expect(verifyRestore()).resolves.toBe(false);
  });

  it('catches an over-refunded order — interleaved snapshots', async () => {
    const { order } = await seedHealthyRestore();
    // refundedTotal > totalAmount: the reservation invariant is broken, and this
    // order would refund money that was already returned.
    await Order.updateOne({ _id: order._id }, { refundedTotal: 150 });

    await expect(verifyRestore()).resolves.toBe(false);
  });

  it('catches a negative order total', async () => {
    const { order } = await seedHealthyRestore();
    await Order.updateOne({ _id: order._id }, { totalAmount: -10 });

    await expect(verifyRestore()).resolves.toBe(false);
  });

  it('catches stores present but users missing — a partial collection restore', async () => {
    await seedHealthyRestore();
    await User.deleteMany({});

    await expect(verifyRestore()).resolves.toBe(false);
  });
});

describe('tolerances', () => {
  it('does not fail a restore merely for being stale', async () => {
    // Data loss is REPORTED (as a warning with the measured age) but is not a
    // failure — only the operator knows the intended recovery point.
    const { order } = await seedHealthyRestore();
    await Order.updateOne(
      { _id: order._id },
      { createdAt: new Date(Date.now() - 36 * 60 * 60 * 1000) }
    );

    await expect(verifyRestore()).resolves.toBe(true);
  });

  it('does not fail a legitimately empty orders collection', async () => {
    // A brand-new tenant has no orders; that is not a broken restore.
    await seedHealthyRestore();
    await Order.deleteMany({});

    await expect(verifyRestore()).resolves.toBe(true);
  });
});
