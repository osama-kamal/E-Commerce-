/**
 * Regression tests for store onboarding.
 *
 * onboardStore created the Store with a THROWAWAY ownerId:
 *
 *     ownerId: new Types.ObjectId(), // placeholder — updated after user creation
 *
 * then created the User, then patched the Store. Three separate writes with no
 * transaction, so a failure in the middle left a store owned by an ObjectId that
 * matches no user — invisible to its real owner and unrecoverable through the UI.
 * store.controller.ts carries three separate workarounds for this exact state.
 *
 * `fullName` was also passed to User.create but absent from the schema, so it was
 * silently discarded — which is why listPendingUpgrades returns ownerName: null.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { onboardStore } from '../../src/modules/onboarding/onboarding.service';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let replSet: MongoMemoryReplSet;

const INPUT = {
  fullName: 'Ada Lovelace',
  email: 'ada@test.com',
  password: 'password123',
  storeName: 'Ada Shop',
  storeCategory: 'other',
};

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  await Promise.all([Store.deleteMany({}), User.deleteMany({})]);
});

// ── Happy path ──────────────────────────────────────────────────────────────

describe('successful onboarding', () => {
  it('creates a store owned by the user it created', async () => {
    const result = await onboardStore({ ...INPUT });

    const store = await Store.findById(result.store._id).lean();
    const user = await User.findById(result.user._id).lean();

    expect(store).toBeTruthy();
    expect(user).toBeTruthy();
    // The core invariant the placeholder broke.
    expect(store!.ownerId.toString()).toBe(user!._id.toString());
    expect(user!.storeId.toString()).toBe(store!._id.toString());
  });

  it('never persists a placeholder ownerId', async () => {
    const result = await onboardStore({ ...INPUT });

    const store = await Store.findById(result.store._id).lean();
    const users = await User.find({}).lean();
    const userIds = users.map((u) => u._id.toString());

    // ownerId must reference a real user, not an orphan ObjectId.
    expect(userIds).toContain(store!.ownerId.toString());
  });

  it('persists fullName instead of discarding it', async () => {
    const result = await onboardStore({ ...INPUT });

    const user = await User.findById(result.user._id).lean();
    expect((user as unknown as { fullName?: string }).fullName).toBe('Ada Lovelace');
  });

  it('gives the owner the admin role', async () => {
    const result = await onboardStore({ ...INPUT });
    const user = await User.findById(result.user._id).lean();
    expect(user!.role).toBe('admin');
  });

  it('returns usable tokens', async () => {
    const result = await onboardStore({ ...INPUT });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('derives a unique slug when the name collides', async () => {
    const a = await onboardStore({ ...INPUT, email: 'a@test.com' });
    const b = await onboardStore({ ...INPUT, email: 'b@test.com' });

    expect(a.store.slug).not.toBe(b.store.slug);
  });
});

// ── Failure path ────────────────────────────────────────────────────────────

describe('partial failure leaves no orphaned store', () => {
  it('does not persist a store when user creation fails', async () => {
    jest.spyOn(User, 'create').mockRejectedValueOnce(new Error('boom') as never);

    await expect(onboardStore({ ...INPUT })).rejects.toThrow();

    // The store must not survive a failed onboarding.
    expect(await Store.countDocuments({})).toBe(0);
    expect(await User.countDocuments({})).toBe(0);
  });

  it('leaves the slug free for a retry after a failure', async () => {
    jest.spyOn(User, 'create').mockRejectedValueOnce(new Error('boom') as never);
    await expect(onboardStore({ ...INPUT })).rejects.toThrow();

    jest.restoreAllMocks();

    // Retrying must produce the clean slug, not "ada-shop-1".
    const retry = await onboardStore({ ...INPUT });
    expect(retry.store.slug).toBe('ada-shop');
  });

  it('rejects a second store for an email that already owns one', async () => {
    await onboardStore({ ...INPUT });

    await expect(onboardStore({ ...INPUT })).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
