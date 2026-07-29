/**
 * Regression tests for the inert NoSQL-sanitization middleware.
 *
 * Before the fix, app.ts registered `mongoSanitize()` at line 76 and
 * `express.json()` at line 86. express-mongo-sanitize walks req.body, but at
 * that point req.body was still undefined, so it silently skipped it and EVERY
 * request body reached route handlers with `$`-operators intact.
 *
 * Proven directly in these tests:
 *   1. The sanitizing layer registered on the real app sits AFTER the JSON body
 *      parser (behavioural probe of the actual middleware stack — no name
 *      matching, so it survives refactors).
 *   2. A `$`-operator payload cannot mutate data through a route that forwards
 *      req.body into a Mongo update.
 *   3. Ordinary requests still work (the parsers were not broken by the move).
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { Product } from '../../src/modules/products/product.model';
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
  await Promise.all([Store.deleteMany({}), User.deleteMany({}), Product.deleteMany({})]);

  const ownerId = new Types.ObjectId();
  store = await Store.create({
    name: 'Sanitize Store', slug: 'sanitize-store', ownerId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  await User.create({
    _id: ownerId, storeId: store._id, email: 'owner@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  adminToken = signAccessToken(ownerId, 'admin', store._id!.toString());
});

// ── 1. Middleware ordering, verified behaviourally ──────────────────────────

describe('mongoSanitize registration order', () => {
  /**
   * Runs each app-level middleware layer against a mock request holding
   * `$`-operators and reports which layer actually strips them. This identifies
   * the sanitizer by what it DOES, not by its (anonymous) function name.
   */
  function findSanitizerIndex(): number {
    const stack = (app as unknown as {
      _router: { stack: Array<{ handle: Function }> };
    })._router.stack;

    for (let i = 0; i < stack.length; i++) {
      const layer = stack[i];
      // Only plain middleware (err, req, res, next) has arity <= 3 here.
      if (typeof layer.handle !== 'function' || layer.handle.length > 3) continue;

      const req: Record<string, unknown> = {
        body: { evil: { $gt: '' } },
        query: {},
        params: {},
        headers: {},
      };
      try {
        layer.handle(req as never, {} as never, (() => {}) as never);
      } catch {
        continue; // layer needs a fuller req/res — not the sanitizer
      }
      const stripped = !JSON.stringify(req.body).includes('$gt');
      if (stripped) return i;
    }
    return -1;
  }

  function findJsonParserIndex(): number {
    const stack = (app as unknown as {
      _router: { stack: Array<{ name: string }> };
    })._router.stack;
    return stack.findIndex((l) => l.name === 'jsonParser');
  }

  it('registers the body-sanitizing middleware AFTER the JSON body parser', () => {
    const jsonIdx = findJsonParserIndex();
    const sanitizeIdx = findSanitizerIndex();

    expect(jsonIdx).toBeGreaterThanOrEqual(0);
    expect(sanitizeIdx).toBeGreaterThanOrEqual(0);
    // This is the whole bug: sanitizeIdx used to be < jsonIdx.
    expect(sanitizeIdx).toBeGreaterThan(jsonIdx);
  });
});

// ── 2. Operators cannot reach a Mongo update ────────────────────────────────

describe('request bodies are sanitized end-to-end', () => {
  it('prevents a $rename operator from mutating documents', async () => {
    const product = await Product.create({
      storeId: store._id,
      name: 'Original Name',
      description: 'desc',
      price: 10,
      stock: 5,
      categoryId: new Types.ObjectId(),
    });

    await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', store._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { $rename: { name: 'pwned' } } });

    // Whatever status comes back, the operator must not have taken effect.
    const after = await Product.collection.findOne({ _id: product._id });
    expect(after!.name).toBe('Original Name');
    expect(after).not.toHaveProperty('pwned');
  });

  it('prevents an $unset operator from deleting fields', async () => {
    const product = await Product.create({
      storeId: store._id,
      name: 'Keep My Name',
      description: 'desc',
      price: 10,
      stock: 5,
      categoryId: new Types.ObjectId(),
    });

    await request(app)
      .put('/api/v1/products/bulk/update')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Store-ID', store._id!.toString())
      .send({ ids: [product._id!.toString()], updates: { $unset: { name: '' } } });

    const after = await Product.collection.findOne({ _id: product._id });
    expect(after!.name).toBe('Keep My Name');
  });
});

// ── 3. No collateral damage from moving the middleware ──────────────────────

describe('body parsing still works after the move', () => {
  it('still parses ordinary JSON bodies', async () => {
    const res = await request(app)
      .post('/api/v1/support/contact-sales')
      .send({ name: 'Jane', storeName: 'Jane Co', phone: '+201234567', requirements: 'hi' });

    // 200/201 on success, or a handled error — but never 422, which would mean
    // the body failed to parse and Zod saw an empty object.
    expect(res.status).not.toBe(422);
  });

  it('rejects a malformed body with a client error, not a crash', async () => {
    const res = await request(app)
      .post('/api/v1/support/contact-sales')
      .send({ name: 'Jane' }); // missing required fields

    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('success', false);
  });

  it('keeps the health endpoint working', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
