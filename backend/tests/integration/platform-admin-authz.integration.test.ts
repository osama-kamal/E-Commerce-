/**
 * Regression tests for the platform-admin privilege-escalation vulnerability.
 *
 * Before the fix, every endpoint documented as "super-admin" was guarded with
 * `authorizeRole('admin', ...)`. Because public onboarding mints users with
 * role: 'admin', anyone could self-register a store and then:
 *   - read every tenant on the platform (incl. Stripe customer IDs),
 *   - grant themselves an enterprise plan,
 *   - deactivate a competitor's store.
 *
 * These tests pin two things:
 *   1. A store-level admin is refused on every platform-scoped endpoint.
 *   2. A store-level admin RETAINS access to their own tenant admin routes,
 *      and a real super-admin retains platform access (no over-correction).
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
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
let storeAdminToken: string;   // role 'admin', owns storeA only
let superAdminToken: string;   // role 'super-admin'

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Store.deleteMany({}), User.deleteMany({})]);

  const ownerAId = new Types.ObjectId();
  const superId = new Types.ObjectId();

  storeA = await Store.create({
    name: 'Store A', slug: 'store-a', ownerId: ownerAId, isActive: true,
    subscriptionPlan: 'free', subscriptionStatus: 'trialing',
  });
  storeB = await Store.create({
    name: 'Store B', slug: 'store-b', ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'free', subscriptionStatus: 'trialing',
  });

  await User.create({
    _id: ownerAId, storeId: storeA._id, email: 'owner-a@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  await User.create({
    _id: superId, storeId: storeA._id, email: 'super@test.com',
    passwordHash: 'x', role: 'super-admin', isActive: true,
  });

  storeAdminToken = signAccessToken(ownerAId, 'admin', storeA._id!.toString());
  superAdminToken = signAccessToken(superId, 'super-admin', storeA._id!.toString());
});

// ── 1. Platform endpoints must reject a store-level admin ───────────────────

describe('platform-admin endpoints reject role:admin', () => {
  it('refuses PATCH /admin/stores/:id/plan on another store', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/stores/${storeB._id}/plan`)
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .send({ plan: 'enterprise', status: 'active' });

    expect(res.status).toBe(403);

    // and the target store must be untouched
    const after = await Store.findById(storeB._id).lean();
    expect(after!.subscriptionPlan).toBe('free');
  });

  it('refuses a store admin upgrading their OWN store for free', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/stores/${storeA._id}/plan`)
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .send({ plan: 'enterprise', status: 'active' });

    expect(res.status).toBe(403);
    const after = await Store.findById(storeA._id).lean();
    expect(after!.subscriptionPlan).toBe('free');
  });

  it('refuses GET /admin/stores (platform-wide tenant listing)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stores')
      .set('Authorization', `Bearer ${storeAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('refuses GET /admin/stores/pending-upgrades (leaks owner emails)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stores/pending-upgrades')
      .set('Authorization', `Bearer ${storeAdminToken}`);

    expect(res.status).toBe(403);
  });

  it('refuses PATCH /stores/:id/admin on another store', async () => {
    const res = await request(app)
      .patch(`/api/v1/stores/${storeB._id}/admin`)
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(403);

    // competitor takedown must not have happened
    const after = await Store.findById(storeB._id).lean();
    expect(after!.isActive).toBe(true);
  });

  it('refuses GET /stores (platform-wide listing)', async () => {
    const res = await request(app)
      .get('/api/v1/stores')
      .set('Authorization', `Bearer ${storeAdminToken}`);

    expect(res.status).toBe(403);
  });

  // PUT /stores/:id is the OWNER route — the ownership filter is correct, but the
  // schema used to permit billing fields, so an owner could self-upgrade for free.
  it('refuses a store owner self-upgrading their plan via PUT /stores/:id', async () => {
    const res = await request(app)
      .put(`/api/v1/stores/${storeA._id}`)
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .send({ subscriptionPlan: 'enterprise', subscriptionStatus: 'active' });

    expect(res.status).toBe(422);

    const after = await Store.findById(storeA._id).lean();
    expect(after!.subscriptionPlan).toBe('free');
    expect(after!.subscriptionStatus).toBe('trialing');
  });

  it('refuses a store owner reactivating a suspended store via PUT /stores/:id', async () => {
    await Store.findByIdAndUpdate(storeA._id, { isActive: false });

    const res = await request(app)
      .put(`/api/v1/stores/${storeA._id}`)
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .send({ isActive: true });

    expect(res.status).toBe(422);

    const after = await Store.findById(storeA._id).lean();
    expect(after!.isActive).toBe(false);
  });

  it('STILL lets a store owner rename their own store', async () => {
    const res = await request(app)
      .put(`/api/v1/stores/${storeA._id}`)
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .send({ name: 'Renamed Store' });

    expect(res.status).toBe(200);

    const after = await Store.findById(storeA._id).lean();
    expect(after!.name).toBe('Renamed Store');
    expect(after!.subscriptionPlan).toBe('free'); // untouched
  });
});

// ── 2. No over-correction: legitimate access must still work ────────────────

describe('legitimate access is preserved', () => {
  it('lets a super-admin list all stores', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stores')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.data).toHaveLength(2);
  });

  it('lets a super-admin change any store plan', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/stores/${storeB._id}/plan`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ plan: 'pro', status: 'active' });

    expect(res.status).toBe(200);
    const after = await Store.findById(storeB._id).lean();
    expect(after!.subscriptionPlan).toBe('pro');
  });

  it('lets a super-admin read pending upgrades', async () => {
    const res = await request(app)
      .get('/api/v1/admin/stores/pending-upgrades')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
  });

  it('STILL lets a store admin reach their own tenant admin dashboard', async () => {
    const res = await request(app)
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .set('X-Store-ID', storeA._id!.toString());

    // The tightened platform guard must not shadow tenant-scoped admin routes.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it('STILL lets a store admin list users in their own store', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${storeAdminToken}`)
      .set('X-Store-ID', storeA._id!.toString());

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated access to platform endpoints', async () => {
    const res = await request(app).get('/api/v1/admin/stores');
    expect(res.status).toBe(401);
  });
});
