/**
 * Authorisation for PATCH /stores/:id/settings.
 *
 * The endpoint authorised on OWNERSHIP alone:
 *
 *     if (existing.ownerId.toString() !== ownerId && !isSuperAdmin) -> 403
 *
 * Every other store-admin surface in the app (products, categories, orders,
 * coupons, customers) authorises on ROLE plus TENANT — `authorizeRole('admin')`
 * with the token's storeId cross-checked against the resolved store. So a store
 * admin could delete the entire catalogue but not change the store's logo, and
 * two legitimate callers were rejected outright:
 *
 *   1. a second admin on the store who is not the `ownerId`;
 *   2. a super-admin using store impersonation — `getStoreToken` deliberately
 *      mints that token with role 'admin' (so the UI enters store mode), which
 *      makes `isSuperAdmin` false while `userId` is still the platform admin's.
 *      Impersonation could therefore open Settings but never save.
 *
 * The tests below pin the corrected model: owner, super-admin, or an admin whose
 * SIGNED token belongs to this store. Everything else stays rejected — the
 * negative cases are the point of this file.
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
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let otherStore: InstanceType<typeof Store>;
let ownerId: Types.ObjectId;

let ownerToken: string;       // owns `store`
let staffAdminToken: string;  // admin OF `store`, but not its ownerId
let impersonationToken: string; // super-admin impersonating `store` (role downgraded to 'admin')
let superAdminToken: string;  // real super-admin token
let foreignAdminToken: string; // admin of a DIFFERENT store
let customerToken: string;    // customer of `store`

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

  ownerId = new Types.ObjectId();
  store = await Store.create({
    name: 'Authz Store', slug: 'authz-store', ownerId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  otherStore = await Store.create({
    name: 'Other Store', slug: 'other-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'active',
  });

  const sid = store._id!.toString();

  await User.create({
    _id: ownerId, storeId: store._id, email: 'owner@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  ownerToken = signAccessToken(ownerId, 'admin', sid);

  const staffId = new Types.ObjectId();
  await User.create({
    _id: staffId, storeId: store._id, email: 'staff@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  staffAdminToken = signAccessToken(staffId, 'admin', sid);

  // Store impersonation: a super-admin, but the minted token carries role
  // 'admin' and the TARGET store's id (see getStoreToken).
  const platformAdminId = new Types.ObjectId();
  await User.create({
    _id: platformAdminId, storeId: otherStore._id, email: 'platform@test.com',
    passwordHash: 'x', role: 'super-admin', isActive: true,
  });
  impersonationToken = signAccessToken(platformAdminId, 'admin', sid);
  superAdminToken = signAccessToken(platformAdminId, 'super-admin', otherStore._id!.toString());

  const foreignId = new Types.ObjectId();
  await User.create({
    _id: foreignId, storeId: otherStore._id, email: 'foreign@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  foreignAdminToken = signAccessToken(foreignId, 'admin', otherStore._id!.toString());

  const custId = new Types.ObjectId();
  await User.create({
    _id: custId, storeId: store._id, email: 'cust@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerToken = signAccessToken(custId, 'customer', sid);
});

const patch = (token: string, body: Record<string, unknown> = { theme: 'luxury' }, id = store._id!.toString()) =>
  request(app)
    .patch(`/api/v1/stores/${id}/settings`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── Allowed ──────────────────────────────────────────────────────────────────

describe('callers that must be allowed', () => {
  it('the store owner', async () => {
    const res = await patch(ownerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.theme).toBe('luxury');
  });

  it('a second admin belonging to the store (not the ownerId)', async () => {
    const res = await patch(staffAdminToken);
    expect(res.status).toBe(200);

    const persisted = await Store.findById(store._id).lean();
    expect(persisted!.theme).toBe('luxury');
  });

  it('a super-admin impersonating the store (token role downgraded to admin)', async () => {
    const res = await patch(impersonationToken);
    expect(res.status).toBe(200);

    const persisted = await Store.findById(store._id).lean();
    expect(persisted!.theme).toBe('luxury');
  });

  it('a super-admin acting cross-tenant with their own token', async () => {
    const res = await patch(superAdminToken);
    expect(res.status).toBe(200);
  });
});

// ── Still rejected — the guard must not become a rubber stamp ────────────────

describe('callers that must stay rejected', () => {
  it('an admin of a DIFFERENT store', async () => {
    const res = await patch(foreignAdminToken);
    expect(res.status).toBe(403);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.theme).toBe('default');
  });

  it('a customer of this very store', async () => {
    const res = await patch(customerToken);
    expect(res.status).toBe(403);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.theme).toBe('default');
  });

  it('an unauthenticated caller', async () => {
    const res = await request(app)
      .patch(`/api/v1/stores/${store._id!.toString()}/settings`)
      .send({ theme: 'luxury' });
    expect(res.status).toBe(401);
  });

  it('a store admin cannot reach ACROSS to another store with their own token', async () => {
    // staffAdmin belongs to `store`; aim them at `otherStore`.
    const res = await patch(staffAdminToken, { theme: 'luxury' }, otherStore._id!.toString());
    expect(res.status).toBe(403);

    const unchanged = await Store.findById(otherStore._id).lean();
    expect(unchanged!.theme).toBe('default');
  });
});
