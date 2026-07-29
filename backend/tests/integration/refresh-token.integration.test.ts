/**
 * Regression tests for refresh-token lifetime and lookup cost.
 *
 * Two defects lived in findAndInvalidateRefreshToken():
 *
 *   A. `expiresAt` was written on every stored token but NEVER read. The lookup
 *      loop matched purely on the bcrypt hash, so a 7-day refresh token kept
 *      working forever. Redis carries a TTL, but Redis is optional and the code
 *      never required it, so the MongoDB path was authoritative and unbounded.
 *
 *   B. Matching ran a sequential bcrypt(12) compare per stored token, and tokens
 *      were only ever removed one at a time on use. Every login $push-ed another,
 *      so a user with many sessions made /auth/refresh cost ~250ms x N of CPU —
 *      a single-account DoS.
 *
 * Tokens are 512 bits of CSPRNG output, so bcrypt bought nothing; they are now
 * stored as SHA-256 and matched by exact lookup. Legacy bcrypt records are still
 * accepted so existing sessions survive the deploy.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';
import * as authService from '../../src/modules/auth/auth.service';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn(),
    sendOrderConfirmationEmail: jest.fn(),
    sendOrderStatusEmail: jest.fn(),
    sendEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

jest.mock('../../src/config/redis', () => ({
  isRedisAvailable: () => false,
  getRedisClient: () => { throw new Error('redis disabled in tests'); },
  connectRedis: jest.fn(),
  disconnectRedis: jest.fn(),
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let userId: Types.ObjectId;

const PASSWORD = 'Sup3rSecret!';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Store.deleteMany({})]);

  store = await Store.create({
    name: 'RT Store', slug: 'rt-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'trialing',
  });

  const user = await User.create({
    storeId: store._id,
    email: 'rt@test.com',
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    role: 'customer',
    isActive: true,
  });
  userId = user._id as Types.ObjectId;
});

/** Reads the raw refreshTokens array, bypassing the schema select:false. */
async function storedTokens() {
  const doc = await User.findById(userId).select('+refreshTokens').lean();
  return (doc as unknown as { refreshTokens: { token: string; expiresAt: Date }[] }).refreshTokens;
}

// ── A. Expiry is enforced ───────────────────────────────────────────────────

describe('refresh token expiry', () => {
  it('rejects a token whose expiresAt has passed', async () => {
    const { tokens } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);

    // Backdate the stored record so it is expired.
    await User.updateOne(
      { _id: userId },
      { $set: { 'refreshTokens.$[].expiresAt': new Date(Date.now() - 1000) } }
    );

    await expect(authService.refresh(tokens.refreshToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('accepts a token that is still within its lifetime', async () => {
    const { tokens } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);

    const next = await authService.refresh(tokens.refreshToken);
    expect(next.accessToken).toBeTruthy();
    expect(next.refreshToken).toBeTruthy();
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
  });

  it('prunes expired tokens from the document', async () => {
    await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    const { tokens: live } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);

    // Expire the FIRST token only.
    const before = await storedTokens();
    await User.updateOne(
      { _id: userId },
      { $set: { [`refreshTokens.0.expiresAt`]: new Date(Date.now() - 1000) } }
    );
    expect(before).toHaveLength(2);

    await authService.refresh(live.refreshToken);

    const after = await storedTokens();
    // Expired one pruned, used one rotated out, new one pushed.
    expect(after).toHaveLength(1);
    expect(after[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ── Rotation and revocation still behave ────────────────────────────────────

describe('rotation and revocation', () => {
  it('invalidates the old token after rotation', async () => {
    const { tokens } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    await authService.refresh(tokens.refreshToken);

    await expect(authService.refresh(tokens.refreshToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('rejects a forged token', async () => {
    await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    const forged = `${userId.toString()}.${crypto.randomBytes(64).toString('hex')}`;

    await expect(authService.refresh(forged)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects refresh for a deactivated account', async () => {
    const { tokens } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    await User.updateOne({ _id: userId }, { isActive: false });

    await expect(authService.refresh(tokens.refreshToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('logout invalidates the token', async () => {
    const { tokens } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    await authService.logout(userId.toString(), tokens.refreshToken);

    await expect(authService.refresh(tokens.refreshToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});

// ── B. Storage format and growth bound ──────────────────────────────────────

describe('token storage', () => {
  it('stores a SHA-256 digest, not a bcrypt hash', async () => {
    await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);

    const [record] = await storedTokens();
    expect(record.token).toMatch(/^[a-f0-9]{64}$/);
    expect(record.token.startsWith('$2')).toBe(false);
  });

  it('still accepts a legacy bcrypt-hashed token so live sessions survive deploy', async () => {
    const raw = `${userId.toString()}.${crypto.randomBytes(64).toString('hex')}`;
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          refreshTokens: {
            token: await bcrypt.hash(raw, 10),
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      }
    );

    const next = await authService.refresh(raw);
    expect(next.accessToken).toBeTruthy();
  });

  it('rejects a legacy bcrypt token once expired', async () => {
    const raw = `${userId.toString()}.${crypto.randomBytes(64).toString('hex')}`;
    await User.updateOne(
      { _id: userId },
      {
        $push: {
          refreshTokens: {
            token: await bcrypt.hash(raw, 10),
            expiresAt: new Date(Date.now() - 1000),
          },
        },
      }
    );

    await expect(authService.refresh(raw)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('bounds how many sessions accumulate on a single account', async () => {
    for (let i = 0; i < 15; i++) {
      await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    }

    const tokens = await storedTokens();
    expect(tokens.length).toBeLessThanOrEqual(10);
  });

  it('keeps the most recent session usable after the cap is reached', async () => {
    for (let i = 0; i < 12; i++) {
      await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);
    }
    const { tokens } = await authService.login(store._id!.toString(), 'rt@test.com', PASSWORD);

    const next = await authService.refresh(tokens.refreshToken);
    expect(next.accessToken).toBeTruthy();
  });
});
