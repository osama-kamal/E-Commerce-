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
import { config } from '../../src/config/index';

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

// ── Custom domain is not self-serve ──────────────────────────────────────────
//
// `resolveStoreByHost` matches `customDomain` BEFORE it considers subdomains,
// and the field carried no format check, no ownership proof and no denylist. A
// merchant on any plan including custom domains could therefore point it at the
// platform's own hostname and have every visitor to the platform homepage
// served their storefront instead — one paid subscription, whole platform.
//
// `store` is on the `pro` plan here, so these fail on AUTHORISATION, not on the
// plan gate. Both HTTP routes that touch the field are covered.

describe('custom domain lockdown', () => {
  const putStore = (token: string, body: Record<string, unknown>, id = store._id!.toString()) =>
    request(app)
      .put(`/api/v1/stores/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('refuses a customDomain from the store owner', async () => {
    const res = await putStore(ownerToken, { customDomain: 'evil.example.com' });

    expect(res.status).toBe(422);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.customDomain).toBeUndefined();
  });

  it('refuses the platform hostname specifically — the takeover case', async () => {
    const platformHost = new URL(config.FRONTEND_URL).hostname;
    const res = await putStore(ownerToken, { customDomain: platformHost });

    expect(res.status).toBe(422);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.customDomain).toBeUndefined();
  });

  it('does not let a rejected body smuggle through the permitted fields', async () => {
    // The whole request must fail, not just the offending key — otherwise a
    // caller learns to pair a forbidden field with a legitimate one.
    const res = await putStore(ownerToken, { name: 'Renamed Store', customDomain: 'evil.example.com' });

    expect(res.status).toBe(422);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.name).toBe('Authz Store');
    expect(unchanged!.customDomain).toBeUndefined();
  });

  it('still accepts an ordinary rename on that route', async () => {
    const res = await putStore(ownerToken, { name: 'Renamed Store' });

    expect(res.status).toBe(200);

    const updated = await Store.findById(store._id).lean();
    expect(updated!.name).toBe('Renamed Store');
  });

  it('ignores customDomain sent to the settings endpoint', async () => {
    // That route has no `validate()` schema; it is safe because the service
    // builds an explicit allowlist. Pinned so it stays that way.
    const res = await patch(ownerToken, { theme: 'luxury', customDomain: 'evil.example.com' });

    expect(res.status).toBe(200);

    const updated = await Store.findById(store._id).lean();
    expect(updated!.customDomain).toBeUndefined();
    expect(updated!.theme).toBe('luxury');
  });

  it('lets a super-admin connect a domain through the admin route', async () => {
    const res = await request(app)
      .patch(`/api/v1/stores/${store._id!.toString()}/admin`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ customDomain: 'Shop.Acme.COM' });

    expect(res.status).toBe(200);

    const updated = await Store.findById(store._id).lean();
    expect(updated!.customDomain).toBe('shop.acme.com');
  });

  it('refuses a platform hostname even from a super-admin', async () => {
    // Deliberately a SUBDOMAIN of the platform host rather than the apex.
    //
    // Under test config FRONTEND_URL is http://localhost:5173, and bare
    // `localhost` has no dot, so the schema's hostname regex rejects it (422)
    // before `assertAssignableCustomDomain` is ever reached. Both layers refuse
    // it, but only a dotted host reaches the guard — which is the layer this
    // test exists to pin, and the one that matters in production where the
    // platform host is a real dotted domain.
    const platformHost = new URL(config.FRONTEND_URL).hostname;
    const res = await request(app)
      .patch(`/api/v1/stores/${store._id!.toString()}/admin`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ customDomain: `api.${platformHost}` });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RESERVED_DOMAIN');
  });

  it('refuses the bare platform apex from a super-admin, by whichever layer catches it', async () => {
    const platformHost = new URL(config.FRONTEND_URL).hostname;
    const res = await request(app)
      .patch(`/api/v1/stores/${store._id!.toString()}/admin`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ customDomain: platformHost });

    expect([400, 422]).toContain(res.status);

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.customDomain).toBeUndefined();
  });

  it('refuses a malformed domain from a super-admin', async () => {
    for (const bad of ['https://shop.acme.com', 'shop.acme.com/path', 'shop.acme.com:8080', 'nodot']) {
      const res = await request(app)
        .patch(`/api/v1/stores/${store._id!.toString()}/admin`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ customDomain: bad });

      expect(res.status).toBe(422);
    }

    const unchanged = await Store.findById(store._id).lean();
    expect(unchanged!.customDomain).toBeUndefined();
  });
});
