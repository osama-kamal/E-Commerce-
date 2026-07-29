/**
 * Multi-tenant isolation coverage.
 *
 * The platform's core promise is that one store can never see or modify another
 * store's data. Before this suite there was no test asserting it anywhere.
 *
 * Every tenant-scoped read and write is exercised from Store A's credentials
 * against Store B's data. These document the CURRENT guarantees so that a future
 * refactor (a dropped storeId filter, a new route) fails loudly.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { Product } from '../../src/modules/products/product.model';
import { Order } from '../../src/modules/orders/order.model';
import { Category } from '../../src/modules/categories/category.model';
import { Coupon } from '../../src/modules/coupons/coupon.model';
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
let adminA: string;          // store A admin token
let customerA: string;       // store A customer token
let productB: InstanceType<typeof Product>;
let orderB: InstanceType<typeof Order>;
let categoryA: InstanceType<typeof Category>;

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
    Store.deleteMany({}), User.deleteMany({}), Product.deleteMany({}),
    Order.deleteMany({}), Category.deleteMany({}), Coupon.deleteMany({}),
  ]);

  const ownerAId = new Types.ObjectId();
  const custAId = new Types.ObjectId();

  storeA = await Store.create({
    name: 'Store A', slug: 'iso-a', ownerId: ownerAId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  storeB = await Store.create({
    name: 'Store B', slug: 'iso-b', ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });

  await User.create({
    _id: ownerAId, storeId: storeA._id, email: 'owner-a@t.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  await User.create({
    _id: custAId, storeId: storeA._id, email: 'cust-a@t.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  await User.create({
    storeId: storeB._id, email: 'cust-b@t.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });

  adminA = signAccessToken(ownerAId, 'admin', storeA._id!.toString());
  customerA = signAccessToken(custAId, 'customer', storeA._id!.toString());

  categoryA = await Category.create({ storeId: storeA._id, name: 'CatA', slug: 'cat-a' });
  const categoryB = await Category.create({ storeId: storeB._id, name: 'CatB', slug: 'cat-b' });

  productB = await Product.create({
    storeId: storeB._id, name: 'B Secret Product', description: 'd',
    price: 999, stock: 5, categoryId: categoryB._id,
  });

  orderB = await Order.create({
    storeId: storeB._id,
    customerId: new Types.ObjectId(),
    items: [{ productId: productB._id, name: 'B Secret Product', price: 999, quantity: 1 }],
    totalAmount: 999,
    status: 'pending',
    shippingAddress: { line1: 'b', city: 'b', state: 'b', postalCode: 'b', country: 'b' },
  });
});

const asStoreA = (r: request.Test, token: string) =>
  r.set('Authorization', `Bearer ${token}`).set('X-Store-ID', storeA._id!.toString());

// ── Catalogue ───────────────────────────────────────────────────────────────

describe('product isolation', () => {
  it('does not list another store products', async () => {
    await Product.create({
      storeId: storeA._id, name: 'A Product', description: 'd',
      price: 10, stock: 1, categoryId: categoryA._id,
    });

    const res = await request(app)
      .get('/api/v1/products')
      .set('X-Store-ID', storeA._id!.toString());

    expect(res.status).toBe(200);
    const names = res.body.data.data.map((p: { name: string }) => p.name);
    expect(names).toEqual(['A Product']);
    expect(names).not.toContain('B Secret Product');
  });

  it('404s when fetching another store product by id', async () => {
    const res = await request(app)
      .get(`/api/v1/products/${productB._id}`)
      .set('X-Store-ID', storeA._id!.toString());

    expect(res.status).toBe(404);
  });

  it("refuses to update another store's product", async () => {
    const res = await asStoreA(
      request(app).put(`/api/v1/products/${productB._id}`), adminA
    ).send({ price: 1 });

    expect(res.status).toBe(404);

    const after = await Product.findById(productB._id).lean();
    expect(after!.price).toBe(999);
  });

  it("refuses to delete another store's product", async () => {
    const res = await asStoreA(
      request(app).delete(`/api/v1/products/${productB._id}`), adminA
    );

    expect(res.status).toBe(404);
    const after = await Product.findById(productB._id).lean();
    expect(after!.isDeleted).toBe(false);
  });

  it("refuses to bulk-delete another store's product", async () => {
    const res = await asStoreA(
      request(app).post('/api/v1/products/bulk/delete'), adminA
    ).send({ ids: [productB._id!.toString()] });

    // Filter is store-scoped, so nothing matches.
    expect(res.body?.data?.deletedCount ?? 0).toBe(0);
    const after = await Product.findById(productB._id).lean();
    expect(after!.isDeleted).toBe(false);
  });

  it("refuses to bulk-update another store's product", async () => {
    await asStoreA(
      request(app).put('/api/v1/products/bulk/update'), adminA
    ).send({ ids: [productB._id!.toString()], updates: { price: 1 } });

    const after = await Product.findById(productB._id).lean();
    expect(after!.price).toBe(999);
  });
});

// ── Orders ──────────────────────────────────────────────────────────────────

describe('order isolation', () => {
  it("does not expose another store's orders to an admin", async () => {
    const res = await asStoreA(request(app).get('/api/v1/orders/admin/all'), adminA);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
  });

  it("404s on another store's order by id", async () => {
    const res = await asStoreA(request(app).get(`/api/v1/orders/${orderB._id}`), customerA);
    expect(res.status).toBe(404);
  });

  it("refuses to change another store's order status", async () => {
    const res = await asStoreA(
      request(app).put(`/api/v1/orders/admin/${orderB._id}/status`), adminA
    ).send({ status: 'cancelled' });

    expect(res.status).toBe(404);
    const after = await Order.findById(orderB._id).lean();
    expect(after!.status).toBe('pending');
  });

  it("refuses to bulk-delete another store's orders", async () => {
    await asStoreA(
      request(app).delete('/api/v1/orders/admin/bulk/delete'), adminA
    ).send({ ids: [orderB._id!.toString()] });

    expect(await Order.countDocuments({ _id: orderB._id })).toBe(1);
  });

  it("refuses to bulk-update another store's order status", async () => {
    await asStoreA(
      request(app).put('/api/v1/orders/admin/bulk/status'), adminA
    ).send({ ids: [orderB._id!.toString()], status: 'cancelled' });

    const after = await Order.findById(orderB._id).lean();
    expect(after!.status).toBe('pending');
  });
});

// ── Users & analytics ───────────────────────────────────────────────────────

describe('user and analytics isolation', () => {
  it("does not list another store's users", async () => {
    const res = await asStoreA(request(app).get('/api/v1/admin/users'), adminA);

    expect(res.status).toBe(200);
    const emails = res.body.data.data.map((u: { email: string }) => u.email);
    expect(emails).toContain('cust-a@t.com');
    expect(emails).not.toContain('cust-b@t.com');
  });

  it("reports zero revenue for a store with no orders of its own", async () => {
    const res = await asStoreA(request(app).get('/api/v1/admin/dashboard'), adminA);

    expect(res.status).toBe(200);
    // Store B has a 999 order; Store A must not see it in its totals.
    expect(JSON.stringify(res.body.data)).not.toContain('999');
  });
});

// ── Coupons ─────────────────────────────────────────────────────────────────

describe('coupon isolation', () => {
  it("cannot redeem another store's coupon code", async () => {
    await Coupon.create({
      storeId: storeB._id, code: 'BONLY', type: 'percent',
      discount: 50, minOrderAmount: 0, maxUses: 0,
    });

    const res = await request(app)
      .post('/api/v1/coupons/validate')
      .set('X-Store-ID', storeA._id!.toString())
      .send({ code: 'BONLY', subtotal: 100 });

    expect(res.status).toBe(400);

    const coupon = await Coupon.findOne({ code: 'BONLY' }).lean();
    expect(coupon!.usedCount).toBe(0);
  });
});

// ── Cross-tenant token use ──────────────────────────────────────────────────

describe('token/tenant mismatch', () => {
  it("rejects a store A token used against store B's context", async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${customerA}`)
      .set('X-Store-ID', storeB._id!.toString());

    expect(res.status).toBe(403);
  });

  it('404s for an inactive store context', async () => {
    await Store.findByIdAndUpdate(storeA._id, { isActive: false });

    const res = await request(app)
      .get('/api/v1/products')
      .set('X-Store-ID', storeA._id!.toString());

    expect(res.status).toBe(404);
  });
});
