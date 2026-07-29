/**
 * Regression tests for the unvalidated bulk endpoints.
 *
 * Four bulk routes were registered with no `validate()` middleware and forwarded
 * raw request-body fragments into Mongo:
 *   PUT    /api/v1/products/bulk/update      -> Product.updateMany(filter, req.body.updates)
 *   POST   /api/v1/products/bulk/delete
 *   PUT    /api/v1/orders/admin/bulk/status  -> Order.updateMany(filter, { status })
 *   DELETE /api/v1/orders/admin/bulk/delete
 *
 * Two concrete exploits are pinned here:
 *   A. Cross-tenant move — `updates: { storeId: <other store> }` relocates a
 *      store's products into another tenant's catalogue. Note this uses NO `$`
 *      operator, so the mongo-sanitizer does not stop it; only an allow-list does.
 *   B. Enum corruption — `status: "<anything>"` bypasses the schema enum
 *      (updateMany does not run validators), poisoning order.status. A later
 *      status transition then dereferences STATUS_TRANSITIONS[bogus] === undefined
 *      and crashes with a 500.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { Product } from '../../src/modules/products/product.model';
import { Order } from '../../src/modules/orders/order.model';
import { signAccessToken } from '../../src/utils/jwt';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrderConfirmationEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendOrderStatusEmail: jest.fn(),
    sendEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let storeA: InstanceType<typeof Store>;
let storeB: InstanceType<typeof Store>;
let adminToken: string;

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
  await Promise.all([
    Store.deleteMany({}), User.deleteMany({}),
    Product.deleteMany({}), Order.deleteMany({}),
  ]);

  const ownerId = new Types.ObjectId();
  storeA = await Store.create({
    name: 'Store A', slug: 'bulk-a', ownerId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  storeB = await Store.create({
    name: 'Store B', slug: 'bulk-b', ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  await User.create({
    _id: ownerId, storeId: storeA._id, email: 'a@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  adminToken = signAccessToken(ownerId, 'admin', storeA._id!.toString());
});

function makeProduct(name = 'Widget', price = 100) {
  return Product.create({
    storeId: storeA._id, name, description: 'd', price,
    stock: 10, categoryId: CATEGORY_ID,
  });
}

function makeOrder(status = 'pending') {
  return Order.create({
    storeId: storeA._id,
    customerId: new Types.ObjectId(),
    items: [{ productId: new Types.ObjectId(), name: 'x', price: 10, quantity: 1 }],
    totalAmount: 10,
    status,
    shippingAddress: { line1: 'a', city: 'b', state: 'c', postalCode: 'd', country: 'e' },
  });
}

// ── A. Cross-tenant mass assignment via products bulk/update ────────────────

describe('PUT /products/bulk/update — field allow-list', () => {
  it('refuses to move products into another store via storeId', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { storeId: storeB._id!.toString() } });

    expect(res.status).toBe(422);

    const after = await Product.findById(product._id).lean();
    expect(after!.storeId.toString()).toBe(storeA._id!.toString());
  });

  it('refuses to forge averageRating / reviewCount', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { averageRating: 5, reviewCount: 9999 } });

    expect(res.status).toBe(422);

    const after = await Product.findById(product._id).lean();
    expect(after!.averageRating).toBe(0);
    expect(after!.reviewCount).toBe(0);
  });

  it('refuses to resurrect soft-deleted products via isDeleted', async () => {
    const product = await Product.create({
      storeId: storeA._id, name: 'Gone', description: 'd', price: 5,
      stock: 1, categoryId: CATEGORY_ID, isDeleted: true,
    });

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { isDeleted: false } });

    expect(res.status).toBe(422);
  });

  it('rejects an out-of-range discount', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { discount: 500 } });

    expect(res.status).toBe(422);
  });

  it('rejects a negative price', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { price: -50 } });

    expect(res.status).toBe(422);
  });

  it('STILL applies a legitimate price + stock update', async () => {
    const product = await makeProduct('Widget', 100);

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { price: 55.5, stock: 3, discount: 10 } });

    expect(res.status).toBe(200);
    expect(res.body.data.updatedCount).toBe(1);

    const after = await Product.findById(product._id).lean();
    expect(after!.price).toBe(55.5);
    expect(after!.stock).toBe(3);
    expect(after!.discount).toBe(10);
  });

  it('rejects a malformed ids array', async () => {
    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: 'not-an-array', updates: { price: 1 } });

    expect(res.status).toBe(422);
  });

  it('rejects an empty updates object', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()], updates: {} });

    expect(res.status).toBe(422);
  });
});

// ── B. Enum corruption via orders bulk/status ───────────────────────────────

describe('PUT /orders/admin/bulk/status — enum enforcement', () => {
  it('refuses an arbitrary status string', async () => {
    const order = await makeOrder('pending');

    const res = await request(app)
      .put('/api/v1/orders/admin/bulk/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [order._id!.toString()], status: 'not-a-real-status' });

    expect(res.status).toBe(422);

    const after = await Order.collection.findOne({ _id: order._id });
    expect(after!.status).toBe('pending');
  });

  it('does not leave orders in a state that crashes a later transition', async () => {
    const order = await makeOrder('pending');

    await request(app)
      .put('/api/v1/orders/admin/bulk/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [order._id!.toString()], status: 'bogus' });

    // A subsequent legitimate transition must not 500.
    const res = await request(app)
      .put(`/api/v1/orders/admin/${order._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ status: 'processing' });

    expect(res.status).not.toBe(500);
  });

  it('STILL applies a legitimate bulk status change', async () => {
    const o1 = await makeOrder('pending');
    const o2 = await makeOrder('pending');

    const res = await request(app)
      .put('/api/v1/orders/admin/bulk/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [o1._id!.toString(), o2._id!.toString()], status: 'processing' });

    expect(res.status).toBe(200);
    expect(res.body.data.updatedCount).toBe(2);

    const after = await Order.findById(o1._id).lean();
    expect(after!.status).toBe('processing');
  });
});

// ── C. Delete endpoints keep working and stay tenant-scoped ─────────────────

describe('bulk delete endpoints', () => {
  it('STILL soft-deletes products in the caller store', async () => {
    const product = await makeProduct();

    const res = await request(app)
      .post('/api/v1/products/bulk/delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [product._id!.toString()] });

    expect(res.status).toBe(200);
    const after = await Product.findById(product._id).lean();
    expect(after!.isDeleted).toBe(true);
  });

  it('rejects a non-array ids payload instead of 500ing', async () => {
    const res = await request(app)
      .post('/api/v1/products/bulk/delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: { $ne: null } });

    expect(res.status).toBe(422);
  });

  it('STILL deletes orders in the caller store', async () => {
    const order = await makeOrder('pending');

    const res = await request(app)
      .delete('/api/v1/orders/admin/bulk/delete')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', storeA._id!.toString())
      .send({ ids: [order._id!.toString()] });

    expect(res.status).toBe(200);
    expect(await Order.countDocuments({})).toBe(0);
  });
});
