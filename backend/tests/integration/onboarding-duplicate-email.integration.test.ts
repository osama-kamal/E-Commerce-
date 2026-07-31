/**
 * Repeat-signup guard for POST /onboarding.
 *
 * The guard inspected ONE arbitrary admin row:
 *
 *     const existingGlobal = await User.findOne({ email, role: 'admin' });
 *     if (existingGlobal) { if (await Store.findOne({ ownerId: existingGlobal._id })) throw 409; }
 *
 * `findOne` has no sort, so when it happened to return an admin that owned no
 * stores, the guard passed and onboarding minted ANOTHER admin user with the
 * same address — allowed, because the unique index is { storeId, email }.
 *
 * The damage is downstream, not here. auth.service.login resolves globally and
 * takes the OLDEST admin, comparing only that one password hash. Every later
 * account is therefore unreachable — its password is rejected, and the stores it
 * owns disappear from GET /stores/mine, which hides the store switcher because
 * AdminLayout requires myStores.length > 1.
 *
 * The first test below is the exact hole: an existing admin owning NO store.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import bcrypt from 'bcryptjs';

import app from '../../src/app';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

// signupLimiter allows 5 signups per hour per IP. This suite deliberately calls
// the endpoint more than that to prove the guard holds across repeats, so every
// limiter is replaced with a pass-through. The limiters themselves are covered
// by rate-limits.integration.test.ts — mocking them here keeps this suite
// testing the duplicate-email guard and nothing else.
jest.mock('../../src/middleware/rateLimiter', () => {
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    authLimiter: passThrough,
    aiLimiter: passThrough,
    signupLimiter: passThrough,
    couponLimiter: passThrough,
    emailLimiter: passThrough,
  };
});

let mongod: MongoMemoryServer;

const EMAIL = 'owner@example.com';

const signup = (overrides: Record<string, unknown> = {}) =>
  request(app).post('/api/v1/onboarding').send({
    fullName: 'Test Owner',
    email: EMAIL,
    password: 'CorrectHorse1!',
    storeName: 'My Store',
    storeCategory: 'fashion',
    ...overrides,
  });

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
});

describe('repeat signup with an existing email', () => {
  it('is rejected when an admin exists that owns NO store (the original hole)', async () => {
    // Exactly the state that let the bug through.
    const orphanAdminId = new Types.ObjectId();
    await User.create({
      _id: orphanAdminId,
      storeId: new Types.ObjectId(),          // points at a store that is not owned
      email: EMAIL,
      passwordHash: await bcrypt.hash('OldPassword1!', 4),
      role: 'admin',
      isActive: true,
    });
    expect(await Store.countDocuments({ ownerId: orphanAdminId })).toBe(0);

    const res = await signup();

    expect(res.status).toBe(409);
    // Critically: no second admin account was created for this address.
    expect(await User.countDocuments({ email: EMAIL, role: 'admin' })).toBe(1);
  });

  it('is rejected when the existing admin DOES own a store', async () => {
    const first = await signup();
    expect(first.status).toBe(201);

    const second = await signup({ storeName: 'Second Store' });
    expect(second.status).toBe(409);

    expect(await User.countDocuments({ email: EMAIL, role: 'admin' })).toBe(1);
    expect(await Store.countDocuments({})).toBe(1);
  });

  it('never leaves more than one admin account per email', async () => {
    await signup();
    await signup({ storeName: 'B' });
    await signup({ storeName: 'C' });

    const admins = await User.find({ email: EMAIL, role: 'admin' }).lean();
    expect(admins).toHaveLength(1);

    // And every store that exists belongs to that single account.
    const stores = await Store.find({}).lean();
    for (const s of stores) {
      expect(s.ownerId.toString()).toBe(admins[0]._id.toString());
    }
  });

  it('still allows a genuinely new email', async () => {
    await signup();
    const other = await signup({ email: 'someone-else@example.com', storeName: 'Other' });

    expect(other.status).toBe(201);
    expect(await Store.countDocuments({})).toBe(2);
  });

  it('does not treat a CUSTOMER with the same email as a blocker', async () => {
    // Customers are per-store shoppers; they must not prevent a store signup.
    await User.create({
      storeId: new Types.ObjectId(),
      email: EMAIL,
      passwordHash: await bcrypt.hash('ShopperPw1!', 4),
      role: 'customer',
      isActive: true,
    });

    const res = await signup();
    expect(res.status).toBe(201);
  });
});
