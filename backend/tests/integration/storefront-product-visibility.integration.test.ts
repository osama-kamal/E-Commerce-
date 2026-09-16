/**
 * The public storefront must see its own products.
 *
 * Raised as a regression after the tenant-isolation work: products visible in
 * the admin panel were reported missing from the storefront. This exercises the
 * real HTTP path the storefront uses — `GET /api/v1/products` with an
 * `X-Store-Slug` header, unauthenticated — and asserts both halves of the
 * requirement at once:
 *
 *   • a shopper DOES see every live product of the store they are browsing
 *   • a shopper does NOT see any other store's products
 *
 * A fix for the first that breaks the second is not a fix.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { Product } from '../../src/modules/products/product.model';
import { Category } from '../../src/modules/categories/category.model';

let mongod: MongoMemoryServer;

let storeA: InstanceType<typeof Store>;
let catShirts: InstanceType<typeof Category>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Store.deleteMany({}), Product.deleteMany({}), Category.deleteMany({})]);

  storeA = await Store.create({
    name: 'Store A', slug: 'store-a', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  const storeB = await Store.create({
    name: 'Store B', slug: 'store-b', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });

  catShirts = await Category.create({ storeId: storeA._id, name: 'Shirts', slug: 'shirts' });
  const catOther = await Category.create({ storeId: storeB._id, name: 'Tools', slug: 'tools' });

  await Product.create({
    storeId: storeA._id, name: 'Linen Shirt', description: 'd',
    price: 40, stock: 5, categoryId: catShirts._id,
  });
  await Product.create({
    storeId: storeA._id, name: 'Wool Coat', description: 'd',
    price: 120, stock: 0, categoryId: catShirts._id,   // out of stock, still listed
  });
  await Product.create({
    storeId: storeA._id, name: 'Deleted Thing', description: 'd',
    price: 10, stock: 5, categoryId: catShirts._id, isDeleted: true,
  });
  await Product.create({
    storeId: storeB._id, name: 'RIVAL Hammer', description: 'd',
    price: 99, stock: 5, categoryId: catOther._id,
  });
});

const listAs = (slug: string, query: Record<string, string | number> = {}) =>
  request(app).get('/api/v1/products').set('X-Store-Slug', slug).query(query);

describe('public product listing', () => {
  it('returns the store\'s products to an anonymous shopper', async () => {
    const res = await listAs('store-a');

    expect(res.status).toBe(200);
    const names = res.body.data.data.map((p: { name: string }) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Linen Shirt', 'Wool Coat']));
  });

  it('lists out-of-stock products (they are shown as unavailable, not hidden)', async () => {
    const names = (await listAs('store-a')).body.data.data.map((p: { name: string }) => p.name);
    expect(names).toContain('Wool Coat');
  });

  it('excludes soft-deleted products', async () => {
    const names = (await listAs('store-a')).body.data.data.map((p: { name: string }) => p.name);
    expect(names).not.toContain('Deleted Thing');
  });

  it('never leaks another store\'s products', async () => {
    const res = await listAs('store-a');
    const names = res.body.data.data.map((p: { name: string }) => p.name);

    expect(names).not.toContain('RIVAL Hammer');
    for (const p of res.body.data.data) {
      expect(p.storeId.toString()).toBe(storeA._id!.toString());
    }
  });

  it('resolves the tenant by X-Store-ID as well as slug', async () => {
    const res = await request(app)
      .get('/api/v1/products')
      .set('X-Store-ID', storeA._id!.toString());

    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBeGreaterThan(0);
  });

  it('404s with no tenant header rather than listing every store', async () => {
    // This is the behaviour a storefront hits when the client fails to send a
    // store header — the products are not "missing", the tenant is.
    const res = await request(app).get('/api/v1/products');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('STORE_NOT_FOUND');
  });
});

describe('category filtering', () => {
  it('filters by a category id belonging to the store', async () => {
    const res = await listAs('store-a', { category: catShirts._id!.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.data.length).toBeGreaterThan(0);
  });

  it('rejects a non-ObjectId category with 400, not an empty list', async () => {
    // Worth pinning because the failure LOOKS like "no products". If a client
    // ever sends a category SLUG instead of an id, the whole listing 400s and
    // the storefront renders empty — indistinguishable from a tenant problem
    // unless you read the response body.
    const res = await listAs('store-a', { category: 'shirts' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/category/i);
  });

  it('returns an empty list for a category with no products, not an error', async () => {
    const emptyCat = await Category.create({
      storeId: storeA._id, name: 'Empty', slug: 'empty',
    });
    const res = await listAs('store-a', { category: emptyCat._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.data.data).toEqual([]);
  });
});

describe('an inactive store is not browsable', () => {
  it('404s once the store is deactivated', async () => {
    await Store.updateOne({ _id: storeA._id }, { isActive: false });

    const res = await listAs('store-a');
    expect(res.status).toBe(404);
  });
});
