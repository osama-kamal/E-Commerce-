/**
 * Tests for rate limiting on expensive/abusable public endpoints.
 *
 * Only /auth/* was rate limited. Everything else fell back to the global
 * 300 req/min, which is far too generous for endpoints that:
 *   - spend money        (chatbot -> a paid OpenAI completion per call)
 *   - create tenants     (onboarding -> an 'admin' user + a store, unauthenticated)
 *   - leak information   (coupon validate -> distinct errors = guessing oracle)
 *   - send email         (newsletter subscribe/unsubscribe, contact-sales)
 *
 * Each limiter is asserted to (a) allow normal use and (b) return 429 once its
 * budget is spent — verified by exhausting it deliberately.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import {
  aiLimiter, signupLimiter, couponLimiter, emailLimiter,
} from '../../src/middleware/rateLimiter';
import { Store } from '../../src/modules/stores/store.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(),
    sendOrderConfirmationEmail: jest.fn(), sendOrderStatusEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;

type Resettable = { resetKey?: (key: string) => void };
const LOCAL_KEYS = ['::ffff:127.0.0.1', '127.0.0.1', '::1'];

function resetAll() {
  for (const limiter of [aiLimiter, signupLimiter, couponLimiter, emailLimiter]) {
    for (const key of LOCAL_KEYS) {
      (limiter as unknown as Resettable).resetKey?.(key);
    }
  }
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  resetAll();
  await Store.deleteMany({});
  store = await Store.create({
    name: 'RL Store', slug: 'rl-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'trialing',
  });
});

/** Fires `n` requests sequentially and returns the status codes. */
async function fire(n: number, make: () => request.Test): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await make()).status);
  return out;
}

// ── Chatbot (paid AI calls) ─────────────────────────────────────────────────

describe('chatbot rate limit', () => {
  const send = () =>
    request(app)
      .post('/api/v1/chatbot/chat')
      .set('X-Store-ID', store._id!.toString())
      .send({ message: 'hello' });

  it('allows a normal conversation', async () => {
    const statuses = await fire(5, send);
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });

  it('returns 429 once the budget is exhausted', async () => {
    const statuses = await fire(35, send);
    expect(statuses).toContain(429);
  });

  it('reports the RATE_LIMITED code', async () => {
    await fire(31, send);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
  });
});

// ── Onboarding (creates tenants) ────────────────────────────────────────────

describe('onboarding rate limit', () => {
  let n = 0;
  const send = () =>
    request(app)
      .post('/api/v1/onboarding')
      .send({
        fullName: 'Spam Bot',
        email: `spam${n++}@test.com`,
        password: 'password123',
        storeName: `Spam Store ${n}`,
        storeCategory: 'other',
      });

  it('allows a genuine signup', async () => {
    const res = await send();
    expect(res.status).not.toBe(429);
  });

  it('blocks bulk tenant creation from one address', async () => {
    const statuses = await fire(8, send);
    expect(statuses).toContain(429);
    // Budget is 5/hour, so at most 5 can have got through.
    expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(5);
  });
});

// ── Coupon validation (guessing oracle) ─────────────────────────────────────

describe('coupon validation rate limit', () => {
  const send = () =>
    request(app)
      .post('/api/v1/coupons/validate')
      .set('X-Store-ID', store._id!.toString())
      .send({ code: `GUESS${Math.random().toString(36).slice(2, 8)}`, subtotal: 100 });

  it('allows a few genuine attempts', async () => {
    const statuses = await fire(3, send);
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });

  it('blocks sustained code guessing', async () => {
    const statuses = await fire(25, send);
    expect(statuses).toContain(429);
  });
});

// ── Email-sending endpoints ─────────────────────────────────────────────────

describe('email endpoint rate limits', () => {
  it('blocks newsletter subscription flooding', async () => {
    const send = () =>
      request(app)
        .post('/api/v1/newsletter/subscribe')
        .set('X-Store-ID', store._id!.toString())
        .send({ email: `flood${Math.random().toString(36).slice(2)}@test.com` });

    const statuses = await fire(8, send);
    expect(statuses).toContain(429);
  });

  it('blocks contact-sales flooding', async () => {
    const send = () =>
      request(app)
        .post('/api/v1/support/contact-sales')
        .send({ name: 'X', storeName: 'Y', phone: '+201234567', requirements: '' });

    const statuses = await fire(8, send);
    expect(statuses).toContain(429);
  });

  it('shares one budget across newsletter and contact-sales', async () => {
    // Both use emailLimiter, so spending it on one blocks the other — that is
    // the intent: the budget is "outbound email triggered by this address".
    await fire(6, () =>
      request(app)
        .post('/api/v1/support/contact-sales')
        .send({ name: 'X', storeName: 'Y', phone: '+201234567', requirements: '' })
    );

    const res = await request(app)
      .post('/api/v1/newsletter/subscribe')
      .set('X-Store-ID', store._id!.toString())
      .send({ email: 'someone@test.com' });

    expect(res.status).toBe(429);
  });
});

// ── Authenticated/tenant traffic is unaffected ──────────────────────────────

describe('normal traffic is not throttled', () => {
  it('does not rate limit product browsing', async () => {
    const statuses = await fire(40, () =>
      request(app).get('/api/v1/products').set('X-Store-ID', store._id!.toString())
    );
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });

  it('does not rate limit the health endpoint', async () => {
    const statuses = await fire(20, () => request(app).get('/api/v1/health'));
    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
