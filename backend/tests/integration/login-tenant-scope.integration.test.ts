/**
 * Login must resolve within ONE tenant.
 *
 * These tests state the intended contract. Several fail against the current
 * implementation — that is the point: they document the defect before it is
 * fixed, and become the regression suite after.
 *
 * The audit described a privilege escalation: a customer of store A whose email
 * also has an admin account elsewhere gets logged into that other store. While
 * confirming it, a larger problem surfaced in the route wiring — see
 * `login route mounting` below.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import bcrypt from 'bcryptjs';
import request from 'supertest';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;

let storeA: InstanceType<typeof Store>;
let storeB: InstanceType<typeof Store>;

const EMAIL = 'shared@example.com';
const PW_A = 'customer-A-password';
const PW_B = 'admin-B-password';

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

  storeA = await Store.create({
    name: 'Store A', slug: 'store-a', ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'free', subscriptionStatus: 'active', trialEndsAt: null,
  });
  storeB = await Store.create({
    name: 'Store B', slug: 'store-b', ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active', trialEndsAt: null,
  });

  // The same person: a shopper at store A, and the owner of store B.
  // Distinct passwords, so which account authenticated is unambiguous.
  await User.create({
    storeId: storeA._id, email: EMAIL,
    passwordHash: await bcrypt.hash(PW_A, 10), role: 'customer', isActive: true,
  });
  await User.create({
    storeId: storeB._id, email: EMAIL,
    passwordHash: await bcrypt.hash(PW_B, 10), role: 'admin', isActive: true,
  });
});

/** Decodes the storeId claim so we can see which tenant the token belongs to. */
function tokenStoreId(accessToken: string): string {
  return JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString()).storeId;
}

function loginAs(store: InstanceType<typeof Store>, password: string) {
  return request(app)
    .post('/api/v1/auth/login')
    .set('X-Store-ID', store._id!.toString())
    .send({ email: EMAIL, password });
}

describe('storefront login is scoped to one tenant', () => {
  it("authenticates the store's OWN customer account", async () => {
    const res = await loginAs(storeA, PW_A);

    expect(res.status).toBe(200);
    // The decisive assertion: the token must belong to store A, not store B.
    expect(tokenStoreId(res.body.data.accessToken)).toBe(storeA._id!.toString());
    expect(res.body.data.user.role).toBe('customer');
  });

  it('refuses an admin password from another store', async () => {
    // The escalation: today this authenticates as store B's admin.
    const res = await loginAs(storeA, PW_B);
    expect(res.status).toBe(401);
  });

  it('never issues a token for a store other than the one being logged into', async () => {
    for (const password of [PW_A, PW_B]) {
      const res = await loginAs(storeA, password);
      if (res.status === 200) {
        expect(tokenStoreId(res.body.data.accessToken)).toBe(storeA._id!.toString());
      }
    }
  });

  it('does not let one store\'s customer reach another store with no account there', async () => {
    // storeB has no customer row for this email — only an admin. A shopper
    // arriving at store B must not be authenticated at all.
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Store-ID', storeB._id!.toString())
      .send({ email: EMAIL, password: PW_A });

    expect(res.status).toBe(401);
  });
});

describe('login route mounting', () => {
  it('receives the resolved store context', async () => {
    // `authRoutes` is mounted twice in app.ts: once at /api/v1/auth with no
    // store resolution, and once inside the tenant router. Express matches in
    // registration order, so the first mount wins and the tenant-scoped one is
    // unreachable — meaning `req.store` is undefined for EVERY login and the
    // store-scoped branch of auth.service.login is dead code.
    //
    // Proven behaviourally: store A's customer password must authenticate the
    // store A account. If the store context never arrives, resolution falls
    // through to the global branch and picks by email alone.
    const res = await loginAs(storeA, PW_A);

    expect(res.status).toBe(200);
    expect(tokenStoreId(res.body.data.accessToken)).toBe(storeA._id!.toString());
  });
});

describe('platform login', () => {
  const platformLogin = (password: string) =>
    request(app).post('/api/v1/auth/platform/login').send({ email: EMAIL, password });

  it('authenticates a merchant with no store context', async () => {
    // The merchant's own surface. Which store they manage is chosen afterwards
    // in the switcher, not by whichever URL they opened.
    const res = await platformLogin(PW_B);

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('admin');
    expect(tokenStoreId(res.body.data.accessToken)).toBe(storeB._id!.toString());
  });

  it('refuses a customer account', async () => {
    // PW_A belongs to a customer. Customers have no platform to sign in to,
    // and admitting them here would rebuild the escalation from the other side.
    const res = await platformLogin(PW_A);
    expect(res.status).toBe(401);
  });

  it('prefers a super-admin over an admin sharing the address', async () => {
    const platformStore = await Store.create({
      name: 'Platform', slug: 'platform-store', ownerId: new Types.ObjectId(),
      isActive: true, subscriptionPlan: 'enterprise', subscriptionStatus: 'active',
      trialEndsAt: null,
    });
    const SUPER_PW = 'operator-password';
    await User.create({
      storeId: platformStore._id, email: EMAIL,
      passwordHash: await bcrypt.hash(SUPER_PW, 10), role: 'super-admin', isActive: true,
    });

    const res = await platformLogin(SUPER_PW);
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('super-admin');
  });

  it('finds the right account when duplicate admin rows have different passwords', async () => {
    // Historical shape: repeat signups minted several admin rows for one
    // address, because the unique index is per-store. Ranking alone would pick
    // one and reject a valid password, locking the merchant out of their own
    // account — so candidates are tried until one matches.
    const storeC = await Store.create({
      name: 'Store C', slug: 'store-c', ownerId: new Types.ObjectId(), isActive: true,
      subscriptionPlan: 'free', subscriptionStatus: 'active', trialEndsAt: null,
    });
    const PW_C = 'second-admin-password';
    await User.create({
      storeId: storeC._id, email: EMAIL,
      passwordHash: await bcrypt.hash(PW_C, 10), role: 'admin', isActive: true,
    });

    // Both must work — neither merchant identity is shadowed by the other.
    expect((await platformLogin(PW_B)).status).toBe(200);
    expect((await platformLogin(PW_C)).status).toBe(200);
  });

  it('rejects an unknown address', async () => {
    const res = await request(app)
      .post('/api/v1/auth/platform/login')
      .send({ email: 'nobody@example.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('does not reveal that a deactivated account exists', async () => {
    await User.updateOne({ storeId: storeB._id, email: EMAIL }, { isActive: false });

    // A wrong password must look identical to a deactivated account, or the
    // endpoint becomes a membership oracle.
    const wrong = await platformLogin('not-the-password');
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('Invalid email or password');

    // With the CORRECT password the reason is safe to disclose.
    const right = await platformLogin(PW_B);
    expect(right.status).toBe(401);
    expect(right.body.message).toMatch(/deactivated/i);
  });
});

describe('two customers at different stores sharing an email', () => {
  beforeEach(async () => {
    // Replace store B's admin with an ordinary customer, so no privileged
    // account exists for the address at all.
    await User.deleteMany({ storeId: storeB._id });
    await User.create({
      storeId: storeB._id, email: EMAIL,
      passwordHash: await bcrypt.hash(PW_B, 10), role: 'customer', isActive: true,
    });
  });

  it('lets each of them into their own store', async () => {
    // Nothing exotic: the same address shopping at two unrelated shops. The
    // unique index is { storeId, email }, so this is an explicitly supported
    // shape — but global resolution collapses it to whichever row is oldest.
    const a = await loginAs(storeA, PW_A);
    expect(a.status).toBe(200);
    expect(tokenStoreId(a.body.data.accessToken)).toBe(storeA._id!.toString());

    const b = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Store-ID', storeB._id!.toString())
      .send({ email: EMAIL, password: PW_B });

    expect(b.status).toBe(200);
    expect(tokenStoreId(b.body.data.accessToken)).toBe(storeB._id!.toString());
  });
});
