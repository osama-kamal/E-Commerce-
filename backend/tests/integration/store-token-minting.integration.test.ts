/**
 * Regression tests for POST /stores/:id/token.
 *
 * The endpoint minted a fresh 15-minute access token using the role carried in
 * the CALLER'S CURRENT TOKEN, and never re-read the user from the database:
 *
 *     const callerRole = req.user!.role;
 *     ...
 *     const tokenRole = (isSuperAdmin && !isOwnStore) ? 'admin' : callerRole;
 *
 * Consequences:
 *   - A deactivated account could keep minting fresh tokens indefinitely, one
 *     from the next, so disabling a user never actually ended their session.
 *   - A demoted admin kept 'admin' in every newly minted token, because the role
 *     was copied from the old token rather than read from the database.
 *
 * Short-lived tokens are an accepted trade-off, but an endpoint that ISSUES new
 * ones must re-check the account against the database.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';
import { signAccessToken, verifyAccessToken } from '../../src/utils/jwt';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let ownerId: Types.ObjectId;
let ownerToken: string;

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
    name: 'Tok Store', slug: 'tok-store', ownerId, isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  await User.create({
    _id: ownerId, storeId: store._id, email: 'owner@test.com',
    passwordHash: 'x', role: 'admin', isActive: true,
  });
  ownerToken = signAccessToken(ownerId, 'admin', store._id!.toString());
});

const mint = (token: string, id = store._id!.toString()) =>
  request(app).post(`/api/v1/stores/${id}/token`).set('Authorization', `Bearer ${token}`);

// ── Deactivation must end the ability to mint ───────────────────────────────

describe('deactivated accounts', () => {
  it('refuses to mint a token for a deactivated user', async () => {
    await User.updateOne({ _id: ownerId }, { isActive: false });

    const res = await mint(ownerToken);
    expect(res.status).toBe(401);
  });

  it('cannot be chained to outlive deactivation', async () => {
    // Works while active…
    const first = await mint(ownerToken);
    expect(first.status).toBe(200);
    const chained = first.body.data.accessToken as string;

    // …then the account is disabled.
    await User.updateOne({ _id: ownerId }, { isActive: false });

    // The previously minted token must not be usable to mint another.
    const second = await mint(chained);
    expect(second.status).toBe(401);
  });

  it('refuses when the user record no longer exists', async () => {
    await User.deleteOne({ _id: ownerId });

    const res = await mint(ownerToken);
    expect(res.status).toBe(401);
  });
});

// ── Role must come from the database, not the presented token ───────────────

describe('role source', () => {
  it('uses the database role, not the role in the caller token', async () => {
    // Demote in the DB while the caller still holds an 'admin' token.
    await User.updateOne({ _id: ownerId }, { role: 'customer' });

    const res = await mint(ownerToken);
    expect(res.status).toBe(200);

    const payload = verifyAccessToken(res.body.data.accessToken);
    expect(payload.role).toBe('customer');
  });

  it('does not let a forged role in the token escalate privileges', async () => {
    // Caller presents a token claiming super-admin; DB says admin.
    const forged = signAccessToken(ownerId, 'super-admin', store._id!.toString());

    const res = await mint(forged);
    expect(res.status).toBe(200);

    const payload = verifyAccessToken(res.body.data.accessToken);
    expect(payload.role).toBe('admin');
  });
});

// ── Existing behaviour preserved ────────────────────────────────────────────

describe('legitimate minting still works', () => {
  it('mints a token scoped to the requested store for an active owner', async () => {
    const res = await mint(ownerToken);

    expect(res.status).toBe(200);
    const payload = verifyAccessToken(res.body.data.accessToken);
    expect(payload.storeId).toBe(store._id!.toString());
    expect(payload.userId).toBe(ownerId.toString());
    expect(payload.role).toBe('admin');
  });

  it('refuses a store the caller does not own', async () => {
    const other = await Store.create({
      name: 'Other', slug: 'tok-other', ownerId: new Types.ObjectId(), isActive: true,
      subscriptionPlan: 'free', subscriptionStatus: 'trialing',
    });

    const res = await mint(ownerToken, other._id!.toString());
    expect(res.status).toBe(403);
  });

  it('lets an active super-admin impersonate another store as admin', async () => {
    const superId = new Types.ObjectId();
    await User.create({
      _id: superId, storeId: store._id, email: 'super@test.com',
      passwordHash: 'x', role: 'super-admin', isActive: true,
    });
    const other = await Store.create({
      name: 'Other', slug: 'tok-other2', ownerId: new Types.ObjectId(), isActive: true,
      subscriptionPlan: 'free', subscriptionStatus: 'trialing',
    });
    const superToken = signAccessToken(superId, 'super-admin', store._id!.toString());

    const res = await mint(superToken, other._id!.toString());

    expect(res.status).toBe(200);
    const payload = verifyAccessToken(res.body.data.accessToken);
    expect(payload.role).toBe('admin'); // impersonation mode
    expect(payload.storeId).toBe(other._id!.toString());
  });

  it('refuses a deactivated super-admin', async () => {
    const superId = new Types.ObjectId();
    await User.create({
      _id: superId, storeId: store._id, email: 'super2@test.com',
      passwordHash: 'x', role: 'super-admin', isActive: false,
    });
    const superToken = signAccessToken(superId, 'super-admin', store._id!.toString());

    const res = await mint(superToken, store._id!.toString());
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post(`/api/v1/stores/${store._id}/token`);
    expect(res.status).toBe(401);
  });
});
