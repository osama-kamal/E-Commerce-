/**
 * Server-side subscription enforcement.
 *
 * ── The flaw this pins ────────────────────────────────────────────────────────
 * `subscriptionStatus` was written by the Stripe webhooks and by `runDunningJob`
 * and then never read as a gate anywhere on the server. Trial expiry was
 * computed in the browser (`useTrialStatus.ts`: `createdAt + 7 days`) and
 * enforced by a React component that hid the dashboard. A suspended, non-paying
 * store therefore kept 100% of its API access, and any expired trial could be
 * revived by clearing localStorage or calling the API directly.
 *
 * Two separate properties are covered here, because they are separate axes:
 *
 *   ACCESS      — a suspended store cannot transact (HTTP 402), but stays
 *                 readable so its storefront and customers are not punished.
 *   ENTITLEMENT — a store whose subscription lapsed falls back to FREE limits
 *                 even though `subscriptionPlan` still reads 'pro', because
 *                 `runDunningJob` suspends without touching the plan field.
 *
 * The billing escape hatch gets its own block. Those routes are mounted outside
 * the tenant router in app.ts specifically so a suspended merchant can still
 * reach the checkout that reinstates them; if a refactor moves them under the
 * gate, merchants get locked out of paying and those tests fail loudly.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { Product } from '../../src/modules/products/product.model';
import { signAccessToken } from '../../src/utils/jwt';
import {
  resolveSubscriptionAccess,
  trialEndFrom,
  TRIAL_DAYS,
} from '../../src/modules/stores/subscription-access';
import * as productService from '../../src/modules/products/product.service';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
    sendOrderConfirmationEmail: jest.fn(), sendOrderStatusEmail: jest.fn(),
  },
}));

// ── Pure resolver ─────────────────────────────────────────────────────────────
// No database needed: the resolver takes an injected clock precisely so the
// whole matrix is checkable without provisioning a tenant per row.

describe('resolveSubscriptionAccess — entitlement and access matrix', () => {
  const NOW = new Date('2026-06-15T12:00:00Z');
  const future = new Date('2026-06-20T12:00:00Z');
  const past = new Date('2026-06-01T12:00:00Z');

  it('active paid store keeps its declared plan and full access', () => {
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'pro', subscriptionStatus: 'active', trialEndsAt: null }, NOW
    );
    expect(a).toMatchObject({ level: 'full', effectivePlan: 'pro', reason: 'active' });
  });

  it('past_due keeps full access AND its paid entitlement during the dunning grace', () => {
    // Punishing a card that failed an hour ago would churn customers who are
    // about to pay. runDunningJob escalates to `suspended` after 7 days.
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'pro', subscriptionStatus: 'past_due', trialEndsAt: null }, NOW
    );
    expect(a).toMatchObject({ level: 'full', effectivePlan: 'pro', reason: 'grace_period' });
  });

  it('pending_upgrade is never restricted — the merchant is mid-payment', () => {
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'free', subscriptionStatus: 'pending_upgrade', trialEndsAt: null }, NOW
    );
    expect(a.level).toBe('full');
    expect(a.reason).toBe('pending_upgrade');
  });

  it('trial inside its window reports days remaining', () => {
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'free', subscriptionStatus: 'trialing', trialEndsAt: future }, NOW
    );
    expect(a).toMatchObject({ level: 'full', reason: 'trialing', isTrialing: true });
    expect(a.trialDaysRemaining).toBe(5);
  });

  it('EXPIRED trial downgrades to free but is NOT a lockout', () => {
    // The product decision: Free is sold as a permanent $0 tier, so trial end
    // is a downgrade. The old client-side wall treated it as an eviction.
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'free', subscriptionStatus: 'trialing', trialEndsAt: past }, NOW
    );
    expect(a).toMatchObject({
      level: 'full', effectivePlan: 'free', reason: 'free_tier', isTrialing: false,
    });
  });

  it('cancelled store drops to free limits but keeps operating', () => {
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'pro', subscriptionStatus: 'cancelled', trialEndsAt: null }, NOW
    );
    expect(a).toMatchObject({ level: 'full', effectivePlan: 'free', reason: 'free_tier' });
  });

  it('suspended is the ONLY restricting state, and it drops entitlement to free', () => {
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'pro', subscriptionStatus: 'suspended', trialEndsAt: null }, NOW
    );
    expect(a).toMatchObject({ level: 'restricted', effectivePlan: 'free', reason: 'suspended' });
  });

  it('an un-migrated store (no trialEndsAt key) is never locked out', () => {
    // Enforcement must be inert until `npm run migrate:trial-ends-at` runs,
    // otherwise deploying this would evict every pre-existing tenant at once.
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'free', subscriptionStatus: 'trialing' }, NOW
    );
    expect(a.level).toBe('full');
    expect(a.isTrialing).toBe(true);
  });

  it('a corrupt trialEndsAt is treated as un-migrated, not as instantly expired', () => {
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'free', subscriptionStatus: 'trialing', trialEndsAt: 'not-a-date' }, NOW
    );
    expect(a.level).toBe('full');
    expect(a.reason).toBe('trialing');
  });

  it('an unrecognised status fails OPEN, never into restriction', () => {
    // A status added in a later release, or a typo, must not cut off a paying
    // tenant. `suspended` is only ever reached by being written explicitly.
    const a = resolveSubscriptionAccess(
      { subscriptionPlan: 'pro', subscriptionStatus: 'some_future_status', trialEndsAt: null }, NOW
    );
    expect(a.level).toBe('full');
  });

  it('trialEndFrom stamps the documented trial length', () => {
    const end = trialEndFrom(new Date('2026-06-01T00:00:00Z'));
    expect(end.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(TRIAL_DAYS).toBe(7);
  });
});

// ── HTTP enforcement ──────────────────────────────────────────────────────────

describe('enforceSubscription (HTTP)', () => {
  let mongod: MongoMemoryServer;

  let suspended: InstanceType<typeof Store>;
  let healthy: InstanceType<typeof Store>;

  let suspendedCustomerToken: string;
  let suspendedAdminToken: string;
  let healthyAdminToken: string;
  let superAdminToken: string;

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

    const suspendedOwner = new Types.ObjectId();
    suspended = await Store.create({
      name: 'Suspended Store', slug: 'suspended-store', ownerId: suspendedOwner, isActive: true,
      // Declared plan stays 'pro' on purpose: runDunningJob suspends WITHOUT
      // resetting the plan, which is exactly the entitlement leak under test.
      subscriptionPlan: 'pro', subscriptionStatus: 'suspended', trialEndsAt: null,
    });

    const healthyOwner = new Types.ObjectId();
    healthy = await Store.create({
      name: 'Healthy Store', slug: 'healthy-store', ownerId: healthyOwner, isActive: true,
      subscriptionPlan: 'pro', subscriptionStatus: 'active', trialEndsAt: null,
    });

    await User.create({
      _id: suspendedOwner, storeId: suspended._id, email: 'owner@suspended.com',
      passwordHash: 'x', role: 'admin', isActive: true,
    });
    const customerId = new Types.ObjectId();
    await User.create({
      _id: customerId, storeId: suspended._id, email: 'buyer@suspended.com',
      passwordHash: 'x', role: 'customer', isActive: true,
    });

    suspendedAdminToken = signAccessToken(suspendedOwner, 'admin', suspended._id!.toString());
    suspendedCustomerToken = signAccessToken(customerId, 'customer', suspended._id!.toString());
    healthyAdminToken = signAccessToken(healthyOwner, 'admin', healthy._id!.toString());
    superAdminToken = signAccessToken(new Types.ObjectId(), 'super-admin', suspended._id!.toString());
  });

  const asStore = (r: request.Test, store: InstanceType<typeof Store>) =>
    r.set('X-Store-ID', store._id!.toString());

  // ── Writes are blocked ──────────────────────────────────────────────────────

  it('refuses a new order on a suspended store with 402', async () => {
    const res = await asStore(request(app).post('/api/v1/orders'), suspended)
      .set('Authorization', `Bearer ${suspendedCustomerToken}`)
      .send({ shippingAddress: { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'CO' } });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('refuses merchant writes on a suspended store with 402', async () => {
    const res = await asStore(request(app).post('/api/v1/products'), suspended)
      .set('Authorization', `Bearer ${suspendedAdminToken}`)
      .send({ name: 'X', description: 'Y', price: 1, stock: 1, categoryId: new Types.ObjectId().toString() });

    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('uses 402, not 403 — this is a billing state, not an authorisation failure', async () => {
    const res = await asStore(request(app).post('/api/v1/products'), suspended)
      .set('Authorization', `Bearer ${suspendedAdminToken}`)
      .send({ name: 'X', description: 'Y', price: 1, stock: 1, categoryId: new Types.ObjectId().toString() });

    // Conflating the two would make the client tell a merchant whose card
    // expired that they "do not have permission".
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(402);
  });

  // ── Reads stay open ─────────────────────────────────────────────────────────

  it('still serves the storefront catalogue on a suspended store', async () => {
    // The merchant's billing problem must not 404 their customers or break
    // every indexed URL.
    const res = await asStore(request(app).get('/api/v1/products'), suspended);
    expect(res.status).toBe(200);
  });

  it('still serves merchant reads on a suspended store', async () => {
    const res = await asStore(request(app).get('/api/v1/admin/dashboard'), suspended)
      .set('Authorization', `Bearer ${suspendedAdminToken}`);
    expect(res.status).not.toBe(402);
  });

  // ── Exemptions ──────────────────────────────────────────────────────────────

  it('leaves /auth reachable so a suspended merchant can still sign in', async () => {
    // The recovery flow starts with a login. Gating this would strand the
    // merchant outside the dashboard they need in order to pay.
    const res = await asStore(request(app).post('/api/v1/auth/login'), suspended)
      .send({ email: 'owner@suspended.com', password: 'wrong-but-not-402' });

    expect(res.status).not.toBe(402);
  });

  it('lets a super-admin act on a suspended tenant for support', async () => {
    const res = await asStore(request(app).post('/api/v1/products'), suspended)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'X', description: 'Y', price: 1, stock: 1, categoryId: new Types.ObjectId().toString() });

    expect(res.status).not.toBe(402);
  });

  it('does not interfere with a healthy store', async () => {
    const res = await asStore(request(app).post('/api/v1/products'), healthy)
      .set('Authorization', `Bearer ${healthyAdminToken}`)
      .send({ name: 'X', description: 'Y', price: 1, stock: 1, categoryId: new Types.ObjectId().toString() });

    expect(res.status).not.toBe(402);
  });

  // ── The billing escape hatch ────────────────────────────────────────────────
  // These routes are mounted OUTSIDE tenantRouter in app.ts. If a refactor
  // moves them under the gate, a merchant who cannot pay can never start
  // paying — which is strictly worse than not enforcing at all.

  describe('billing escape hatch stays reachable while suspended', () => {
    it('POST /stores/:id/upgrade-request succeeds and records the request', async () => {
      const res = await request(app)
        .post(`/api/v1/stores/${suspended._id!.toString()}/upgrade-request`)
        .set('X-Store-ID', suspended._id!.toString())
        .set('Authorization', `Bearer ${suspendedAdminToken}`)
        .send({ requestedPlan: 'pro' });

      // Asserted on 200 rather than merely "not 402": a malformed body would
      // also produce a non-402, so a weaker assertion would pass even if the
      // route had been moved behind the gate and never reached at all.
      expect(res.status).toBe(200);

      const after = await Store.findById(suspended._id).lean();
      expect(after?.requestedPlan).toBe('pro');
    });

    it('GET /plans', async () => {
      const res = await request(app)
        .get('/api/v1/plans')
        .set('X-Store-ID', suspended._id!.toString());

      expect(res.status).not.toBe(402);
    });

    it('GET /stores/current', async () => {
      const res = await request(app)
        .get('/api/v1/stores/current')
        .set('X-Store-ID', suspended._id!.toString());

      expect(res.status).toBe(200);
      // The client needs the reason in order to explain the 402s it is about
      // to receive, rather than showing a generic error.
      expect(res.body.data.subscription).toMatchObject({
        level: 'restricted',
        reason: 'suspended',
        effectivePlan: 'free',
      });
    });

    it('GET /stores/mine', async () => {
      const res = await request(app)
        .get('/api/v1/stores/mine')
        .set('Authorization', `Bearer ${suspendedAdminToken}`);

      expect(res.status).not.toBe(402);
    });
  });

  // ── Entitlement fallback ────────────────────────────────────────────────────

  it('a CANCELLED pro store is held to free product limits', async () => {
    // Access is unrestricted (cancelling is a downgrade, not an eviction), so
    // this exercises entitlement rather than the gate. `subscriptionPlan` still
    // reads 'pro'; reading that field directly is what leaked unlimited
    // products to stores that had stopped paying.
    const owner = new Types.ObjectId();
    const lapsed = await Store.create({
      name: 'Lapsed', slug: 'lapsed-store', ownerId: owner, isActive: true,
      subscriptionPlan: 'pro', subscriptionStatus: 'cancelled', trialEndsAt: null,
    });
    const storeId = lapsed._id!.toString();
    const categoryId = new Types.ObjectId().toString();

    // PLAN_LIMITS.free.maxProducts === 15
    await Product.insertMany(
      Array.from({ length: 15 }, (_, i) => ({
        storeId: lapsed._id, name: `P${i}`, description: 'd', price: 1, stock: 1,
        categoryId: new Types.ObjectId(categoryId), isDeleted: false,
      }))
    );

    await expect(
      productService.createProduct({
        storeId, name: 'P16', description: 'd', price: 1, stock: 1, categoryId,
      })
    ).rejects.toMatchObject({ statusCode: 403, code: 'PLAN_LIMIT_EXCEEDED' });
  });

  it('an ACTIVE pro store is not held to free product limits', async () => {
    // Guards against the fallback being applied too eagerly.
    const owner = new Types.ObjectId();
    const paid = await Store.create({
      name: 'Paid', slug: 'paid-store', ownerId: owner, isActive: true,
      subscriptionPlan: 'pro', subscriptionStatus: 'active', trialEndsAt: null,
    });
    const storeId = paid._id!.toString();
    const categoryId = new Types.ObjectId().toString();

    await Product.insertMany(
      Array.from({ length: 15 }, (_, i) => ({
        storeId: paid._id, name: `P${i}`, description: 'd', price: 1, stock: 1,
        categoryId: new Types.ObjectId(categoryId), isDeleted: false,
      }))
    );

    const created = await productService.createProduct({
      storeId, name: 'P16', description: 'd', price: 1, stock: 1, categoryId,
    });
    expect(created._id).toBeDefined();
  });
});
