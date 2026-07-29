/**
 * Regression tests for inventory correctness.
 *
 * Two defects:
 *
 *   A. decrementStock issued an unconditional `$inc: { stock: -qty }`. The stock
 *      check in placeOrder is a separate read, so the check-then-write is not
 *      atomic. MongoDB transactions mask this on a replica set, but placeOrder
 *      has an explicit non-transactional fallback for standalone/Atlas-M0
 *      deployments where nothing prevents stock going negative.
 *
 *   B. Cancelling an order never returned its units to stock. Neither
 *      cancelMyOrder (customer) nor updateOrderStatus -> 'cancelled' (admin)
 *      restored inventory, so every cancellation permanently destroyed stock.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { placeOrder, cancelMyOrder, updateOrderStatus } from '../../src/modules/orders/order.service';
import * as productRepo from '../../src/modules/products/product.repository';
import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { Cart } from '../../src/modules/cart/cart.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrderConfirmationEmail: jest.fn(),
    sendOrderStatusEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendEmail: jest.fn(),
    verifyConnection: jest.fn(),
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
    name: 'Stock Store', slug: 'stock-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  const customer = await User.create({
    storeId: store._id, email: 'c@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerId = customer._id as Types.ObjectId;
});

async function seed(stock: number, qty: number) {
  const product = await Product.create({
    storeId: store._id, name: 'Widget', description: 'd',
    price: 25, stock, categoryId: CATEGORY_ID,
  });
  await Cart.create({
    storeId: store._id, customerId,
    items: [{ productId: product._id, quantity: qty, priceSnapshot: 25 }],
  });
  return product;
}

const stockOf = async (id: Types.ObjectId) =>
  (await Product.findById(id).lean())!.stock;

// ── A. decrementStock must never drive stock negative ───────────────────────

describe('decrementStock', () => {
  it('refuses to decrement below zero', async () => {
    const product = await Product.create({
      storeId: store._id, name: 'Scarce', description: 'd',
      price: 10, stock: 2, categoryId: CATEGORY_ID,
    });

    await expect(
      productRepo.decrementStock(product._id as Types.ObjectId, store._id as Types.ObjectId, 5)
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });

    expect(await stockOf(product._id as Types.ObjectId)).toBe(2);
  });

  it('applies a decrement that fits available stock', async () => {
    const product = await Product.create({
      storeId: store._id, name: 'Plenty', description: 'd',
      price: 10, stock: 10, categoryId: CATEGORY_ID,
    });

    await productRepo.decrementStock(product._id as Types.ObjectId, store._id as Types.ObjectId, 4);
    expect(await stockOf(product._id as Types.ObjectId)).toBe(6);
  });

  it('is safe under concurrent decrements of the last units', async () => {
    const product = await Product.create({
      storeId: store._id, name: 'LastOne', description: 'd',
      price: 10, stock: 1, categoryId: CATEGORY_ID,
    });

    const results = await Promise.allSettled([
      productRepo.decrementStock(product._id as Types.ObjectId, store._id as Types.ObjectId, 1),
      productRepo.decrementStock(product._id as Types.ObjectId, store._id as Types.ObjectId, 1),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await stockOf(product._id as Types.ObjectId)).toBe(0);
  });

  it('is scoped to the owning store', async () => {
    const other = await Store.create({
      name: 'Other', slug: 'other-store', ownerId: new Types.ObjectId(),
      isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'trialing',
    });
    const product = await Product.create({
      storeId: store._id, name: 'Mine', description: 'd',
      price: 10, stock: 5, categoryId: CATEGORY_ID,
    });

    await expect(
      productRepo.decrementStock(product._id as Types.ObjectId, other._id as Types.ObjectId, 1)
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });

    expect(await stockOf(product._id as Types.ObjectId)).toBe(5);
  });
});

// ── B. Cancellation returns units to stock ──────────────────────────────────

describe('customer cancellation restores stock', () => {
  it('returns the ordered units when a pending order is cancelled', async () => {
    const product = await seed(10, 3);

    const order = await placeOrder(
      store._id!.toString(), customerId.toString(), SHIPPING, 'cod'
    );
    expect(await stockOf(product._id as Types.ObjectId)).toBe(7);

    await cancelMyOrder(store._id!.toString(), customerId.toString(), order._id.toString());

    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });

  it('marks the order cancelled', async () => {
    await seed(10, 1);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    const cancelled = await cancelMyOrder(
      store._id!.toString(), customerId.toString(), order._id.toString()
    );

    expect(cancelled.status).toBe('cancelled');
  });

  it('does not restore twice when cancellation is attempted again', async () => {
    const product = await seed(10, 3);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await cancelMyOrder(store._id!.toString(), customerId.toString(), order._id.toString());
    await expect(
      cancelMyOrder(store._id!.toString(), customerId.toString(), order._id.toString())
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });

  it('restores at most once under concurrent cancellation', async () => {
    const product = await seed(10, 3);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await Promise.allSettled([
      cancelMyOrder(store._id!.toString(), customerId.toString(), order._id.toString()),
      cancelMyOrder(store._id!.toString(), customerId.toString(), order._id.toString()),
    ]);

    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });
});

describe('admin cancellation restores stock', () => {
  it('returns units when an admin cancels a pending order', async () => {
    const product = await seed(10, 4);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');
    expect(await stockOf(product._id as Types.ObjectId)).toBe(6);

    await updateOrderStatus(store._id!.toString(), order._id.toString(), 'cancelled');

    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });

  it('returns units when an admin cancels a processing order', async () => {
    const product = await seed(10, 2);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await updateOrderStatus(store._id!.toString(), order._id.toString(), 'processing');
    expect(await stockOf(product._id as Types.ObjectId)).toBe(8);

    await updateOrderStatus(store._id!.toString(), order._id.toString(), 'cancelled');
    expect(await stockOf(product._id as Types.ObjectId)).toBe(10);
  });

  it('does NOT restore stock for a non-cancel transition', async () => {
    const product = await seed(10, 2);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await updateOrderStatus(store._id!.toString(), order._id.toString(), 'processing');
    await updateOrderStatus(store._id!.toString(), order._id.toString(), 'shipped');
    await updateOrderStatus(store._id!.toString(), order._id.toString(), 'delivered');

    expect(await stockOf(product._id as Types.ObjectId)).toBe(8);
  });

  it('still rejects an invalid status transition', async () => {
    await seed(10, 1);
    const order = await placeOrder(store._id!.toString(), customerId.toString(), SHIPPING, 'cod');

    await expect(
      updateOrderStatus(store._id!.toString(), order._id.toString(), 'delivered')
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
