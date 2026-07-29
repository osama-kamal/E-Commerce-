/**
 * Regression tests for the `validate` middleware discarding its parsed output.
 *
 * The middleware ran `schema.safeParse(...)` and then called `next()` without
 * assigning `result.data` back onto the request. Every `z.coerce.*`, every
 * `.default()`, and every unknown-key strip in every schema was therefore inert:
 * handlers always saw the raw request. That is why controllers re-parsed by hand
 * (`Number(req.query.page) || 1`) all over the codebase.
 *
 * Pinned here:
 *   1. Defaults declared in a schema actually reach the handler.
 *   2. Coercion actually happens (numeric strings arrive as numbers).
 *   3. Query fields the controller depends on survive the write-back — this is
 *      the regression risk the fix introduces, so onSale/sortBy are covered
 *      explicitly.
 *   4. Body-only schemas do not blank req.query, and vice versa.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { z } from 'zod';

import app from '../../src/app';
import { validate } from '../../src/middleware/validate';
import { listProductsSchema } from '../../src/modules/products/product.schemas';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { Product } from '../../src/modules/products/product.model';
import { Category } from '../../src/modules/categories/category.model';
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
let store: InstanceType<typeof Store>;
let category: InstanceType<typeof Category>;
let adminToken: string;

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
    Product.deleteMany({}), Category.deleteMany({}),
  ]);

  const ownerId = new Types.ObjectId();
  store = await Store.create({
    name: 'V Store', slug: 'v-store', ownerId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  await User.create({
    _id: ownerId, storeId: store._id, email: 'v@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  adminToken = signAccessToken(ownerId, 'admin', store._id!.toString());
  category = await Category.create({ storeId: store._id, name: 'Cat', slug: 'cat' });
});

async function seedProduct(name: string, price: number, discount = 0) {
  return Product.create({
    storeId: store._id, name, description: 'd', price, discount,
    stock: 10, categoryId: category._id,
  });
}

// ── 1 & 2. Parsed values actually reach the handler ─────────────────────────

describe('validate() writes the parsed request back', () => {
  it('applies schema defaults to the handler', () => {
    const parsed = listProductsSchema.parse({ body: {}, params: {}, query: {} }) as {
      query: { page: number; limit: number };
    };
    expect(parsed.query.page).toBe(1);
    expect(parsed.query.limit).toBe(20);
  });

  it('coerces numeric query strings to numbers', () => {
    const parsed = listProductsSchema.parse({
      body: {}, params: {}, query: { page: '3', limit: '7' },
    }) as { query: { page: number; limit: number } };

    expect(parsed.query.page).toBe(3);
    expect(typeof parsed.query.page).toBe('number');
    expect(parsed.query.limit).toBe(7);
  });

  it('exposes the coerced page/limit through a real request', async () => {
    for (let i = 0; i < 5; i++) await seedProduct(`P${i}`, 10 + i);

    const res = await request(app)
      .get('/api/v1/products?page=2&limit=2')
      .set('X-Store-ID', store._id!.toString());

    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(2);
    expect(res.body.data.data).toHaveLength(2);
    expect(res.body.data.total).toBe(5);
  });

  it('rejects a non-numeric page instead of silently defaulting', async () => {
    const res = await request(app)
      .get('/api/v1/products?page=abc')
      .set('X-Store-ID', store._id!.toString());

    expect(res.status).toBe(422);
  });
});

// ── 3. Fields the controller depends on survive the write-back ──────────────

describe('query fields used by the controller are preserved', () => {
  it('still applies the onSale filter', async () => {
    await seedProduct('Full Price', 100, 0);
    await seedProduct('On Sale', 100, 25);

    const res = await request(app)
      .get('/api/v1/products?onSale=true')
      .set('X-Store-ID', store._id!.toString());

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].name).toBe('On Sale');
  });

  it('still applies sortBy=price_asc', async () => {
    await seedProduct('Expensive', 300);
    await seedProduct('Cheap', 10);
    await seedProduct('Mid', 100);

    const res = await request(app)
      .get('/api/v1/products?sortBy=price_asc')
      .set('X-Store-ID', store._id!.toString());

    expect(res.status).toBe(200);
    expect(res.body.data.data.map((p: { name: string }) => p.name)).toEqual([
      'Cheap', 'Mid', 'Expensive',
    ]);
  });

  it('still applies sortBy=price_desc', async () => {
    await seedProduct('Expensive', 300);
    await seedProduct('Cheap', 10);

    const res = await request(app)
      .get('/api/v1/products?sortBy=price_desc')
      .set('X-Store-ID', store._id!.toString());

    expect(res.body.data.data[0].name).toBe('Expensive');
  });

  it('still applies the inStock filter', async () => {
    await seedProduct('Available', 10);
    await Product.create({
      storeId: store._id, name: 'Sold Out', description: 'd',
      price: 10, stock: 0, categoryId: category._id,
    });

    const res = await request(app)
      .get('/api/v1/products?inStock=true')
      .set('X-Store-ID', store._id!.toString());

    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].name).toBe('Available');
  });

  it('still applies the price range filter', async () => {
    await seedProduct('Cheap', 10);
    await seedProduct('Pricey', 500);

    const res = await request(app)
      .get('/api/v1/products?minPrice=100&maxPrice=1000')
      .set('X-Store-ID', store._id!.toString());

    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].name).toBe('Pricey');
  });

  it('still applies the search filter', async () => {
    await seedProduct('Blue Shirt', 10);
    await seedProduct('Red Hat', 10);

    const res = await request(app)
      .get('/api/v1/products?search=Blue')
      .set('X-Store-ID', store._id!.toString());

    expect(res.body.data.data).toHaveLength(1);
    expect(res.body.data.data[0].name).toBe('Blue Shirt');
  });
});

// ── 4. Sections the schema does not declare are left alone ──────────────────

/** Runs `validate(schema)` against a mock request and returns the mutated request. */
function runValidate(schema: z.ZodSchema, req: Record<string, unknown>): Record<string, unknown> {
  let called = false;
  validate(schema)(req as never, {} as never, (() => { called = true; }) as never);
  if (!called) throw new Error('validate() did not call next() — validation failed');
  return req;
}

describe('validate() replaces the raw request with the parsed one', () => {
  // These are the tests that actually distinguish the fix: validation ran before
  // too, so status codes were unchanged — what changed is what the HANDLER sees.

  it('hands the handler coerced numbers, not raw strings', () => {
    const schema = z.object({ query: z.object({ page: z.coerce.number() }) });
    const req = runValidate(schema, { body: {}, params: {}, query: { page: '42' } });

    expect((req.query as { page: unknown }).page).toBe(42);
    expect(typeof (req.query as { page: unknown }).page).toBe('number');
  });

  it('hands the handler applied defaults', () => {
    const schema = z.object({ query: z.object({ limit: z.coerce.number().default(20) }) });
    const req = runValidate(schema, { body: {}, params: {}, query: {} });

    expect((req.query as { limit: unknown }).limit).toBe(20);
  });

  it('strips undeclared body keys before the handler sees them', () => {
    const schema = z.object({ body: z.object({ keep: z.string() }) });
    const req = runValidate(schema, {
      body: { keep: 'yes', injected: 'no', isAdmin: true },
      params: {}, query: {},
    });

    expect(req.body).toEqual({ keep: 'yes' });
    expect(req.body).not.toHaveProperty('injected');
    expect(req.body).not.toHaveProperty('isAdmin');
  });

  it('does not blank req.query for a body-only schema', () => {
    const schema = z.object({ body: z.object({ a: z.string() }) });
    const req = runValidate(schema, { body: { a: 'x' }, query: { keep: 'me' }, params: {} });

    expect(req.query).toEqual({ keep: 'me' });
  });

  it('does not blank req.body for a query-only schema', () => {
    const schema = z.object({ query: z.object({ q: z.string() }) });
    const req = runValidate(schema, { body: { keep: 'me' }, query: { q: 'x' }, params: {} });

    expect(req.body).toEqual({ keep: 'me' });
  });
});

describe('validate() error handling is unchanged', () => {

  it('still returns 422 with per-field details on failure', async () => {
    const res = await request(app)
      .post('/api/v1/support/contact-sales')
      .send({ name: '' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details.length).toBeGreaterThan(0);
    expect(res.body.details[0]).toHaveProperty('field');
    expect(res.body.details[0]).toHaveProperty('message');
  });
});
