/**
 * Tests for the abandoned-checkout reservation release.
 *
 * placeOrder creates the order and decrements stock BEFORE the customer pays
 * (CheckoutPage submits the shipping step, then moves to payment). A shopper who
 * closes the tab on the payment step leaves an unpayable pending order holding
 * units that never return to the catalogue.
 *
 * Restructuring checkout so the order is only created after payment confirms is
 * a much larger change touching both gateways and the webhook/order linkage.
 * This job removes the concrete harm — permanently held inventory — without it.
 *
 * NOTE: this is new behaviour, so these are specification tests rather than
 * regression proofs; there is no "before" state in which they would fail for the
 * right reason.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { placeOrder, expireStalePendingOrders } from '../../src/modules/orders/order.service';
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
  await Promise.all([
    Order.deleteMany({}), Product.deleteMany({}), Cart.deleteMany({}),
    User.deleteMany({}), Store.deleteMany({}),
  ]);

  store = await Store.create({
    name: 'Exp Store', slug: 'exp-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  const customer = await User.create({
    storeId: store._id, email: 'e@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerId = customer._id as Types.ObjectId;
});

async function placeWith(method: 'online' | 'cod', stock = 10, qty = 2) {
  const product = await Product.create({
    storeId: store._id, name: 'Widget', description: 'd',
    price: 25, stock, categoryId: CATEGORY_ID,
  });
  // Upsert — checkout empties the cart's items but leaves the document, and
  // (storeId, customerId) is uniquely indexed, so a second create() would collide.
  await Cart.updateOne(
    { storeId: store._id, customerId },
    { $set: { items: [{ productId: product._id, quantity: qty, priceSnapshot: 25 }] } },
    { upsert: true }
  );
  const order = await placeOrder(
    store._id!.toString(), customerId.toString(), SHIPPING, method,
    undefined,
    // Distinct key per order — see the compound-index test suite for why two
    // key-less orders from one customer currently collide.
    `test_${new Types.ObjectId().toString()}`
  );
  return { product, order };
}

/** Backdates an order so it falls outside the reservation window. */
async function age(orderId: Types.ObjectId, minutes: number) {
  await Order.collection.updateOne(
    { _id: orderId },
    { $set: { createdAt: new Date(Date.now() - minutes * 60 * 1000) } }
  );
}

const stockOf = async (id: Types.ObjectId) => (await Product.findById(id).lean())!.stock;

describe('expireStalePendingOrders', () => {
  it('cancels an abandoned online order and returns its stock', async () => {
    const { product, order } = await placeWith('online', 10, 2);
    expect(await stockOf(product._id as Types.ObjectId)).toBe(8);

    await age(order._id, 60);
    const released = await expireStalePendingOrders(30);

    expect(released).toBe(1);
    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
    expect((await Order.findById(order._id).lean())!.status).toBe('cancelled');
  });

  it('leaves a recent online order untouched', async () => {
    const { product, order } = await placeWith('online', 10, 2);

    const released = await expireStalePendingOrders(30);

    expect(released).toBe(0);
    expect(await stockOf(product._id as Types.ObjectId)).toBe(8);
    expect((await Order.findById(order._id).lean())!.status).toBe('pending');
  });

  it('NEVER expires a cash-on-delivery order', async () => {
    const { product, order } = await placeWith('cod', 10, 2);
    await age(order._id, 60 * 24 * 7); // a week old

    const released = await expireStalePendingOrders(30);

    expect(released).toBe(0);
    expect((await Order.findById(order._id).lean())!.status).toBe('pending');
    expect(await stockOf(product._id as Types.ObjectId)).toBe(8);
  });

  it('does not touch an order that has moved past pending', async () => {
    const { product, order } = await placeWith('online', 10, 2);
    await Order.updateOne({ _id: order._id }, { status: 'processing' });
    await age(order._id, 60);

    const released = await expireStalePendingOrders(30);

    expect(released).toBe(0);
    expect((await Order.findById(order._id).lean())!.status).toBe('processing');
    expect(await stockOf(product._id as Types.ObjectId)).toBe(8);
  });

  it('is idempotent across repeated runs', async () => {
    const { product, order } = await placeWith('online', 10, 3);
    await age(order._id, 60);

    expect(await expireStalePendingOrders(30)).toBe(1);
    expect(await expireStalePendingOrders(30)).toBe(0);
    expect(await expireStalePendingOrders(30)).toBe(0);

    // Restored exactly once — not 13 or 16.
    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });

  it('restores stock at most once under concurrent runs', async () => {
    const { product, order } = await placeWith('online', 10, 3);
    await age(order._id, 60);

    await Promise.allSettled([
      expireStalePendingOrders(30),
      expireStalePendingOrders(30),
    ]);

    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });

  it('processes several abandoned orders in one run', async () => {
    const a = await placeWith('online', 10, 1);
    await age(a.order._id, 60);
    const b = await placeWith('online', 10, 4);
    await age(b.order._id, 60);

    const released = await expireStalePendingOrders(30);

    expect(released).toBe(2);
    expect(await stockOf(a.product._id as Types.ObjectId)).toBe(10);
    expect(await stockOf(b.product._id as Types.ObjectId)).toBe(10);
  });

  it('returns 0 when there is nothing to release', async () => {
    expect(await expireStalePendingOrders(30)).toBe(0);
  });

  it('uses an index rather than scanning the whole orders collection', async () => {
    // The sweep is deliberately cross-tenant (no storeId), so none of the
    // tenant-scoped compounds could serve it — it was a COLLSCAN every 5
    // minutes. Verified against the real planner rather than by inspection.
    await Order.syncIndexes();

    const plan = await Order.collection
      .find({
        status: 'pending',
        paymentMethod: 'online',
        createdAt: { $lt: new Date() },
      })
      .explain('queryPlanner');

    const winning = JSON.stringify(
      (plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? {}
    );

    expect(winning).toContain('IXSCAN');
    expect(winning).not.toContain('COLLSCAN');
  });
});
