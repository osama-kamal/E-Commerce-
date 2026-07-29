/**
 * Regression tests for coupon usage limits.
 *
 * validateAndApplyCoupon claimed a use with a single flattened $or:
 *
 *     $or: [
 *       { expiresAt: { $gt: now } },      // expiry branch
 *       { expiresAt: { $exists: false } },
 *       { expiresAt: null },
 *       { maxUses: 0 },                   // usage branch
 *       { $expr: { $lt: ['$usedCount', '$maxUses'] } },
 *     ]
 *
 * $or is satisfied by ANY branch, so a coupon with a future expiry matched on
 * the first branch alone — `maxUses` was never enforced. A "first 50 customers"
 * promotion could be redeemed without limit.
 *
 * The two groups must be ANDed: (not expired) AND (uses remaining).
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { couponService } from '../../src/modules/coupons/coupon.service';
import { Coupon } from '../../src/modules/coupons/coupon.model';

let mongod: MongoMemoryServer;
const STORE_ID = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Coupon.deleteMany({});
});

const FUTURE = () => new Date(Date.now() + 30 * 86_400_000);
const PAST = () => new Date(Date.now() - 86_400_000);

async function makeCoupon(overrides: Record<string, unknown> = {}) {
  return Coupon.create({
    storeId: STORE_ID,
    code: 'SAVE10',
    type: 'percent',
    discount: 10,
    minOrderAmount: 0,
    maxUses: 0,
    isActive: true,
    ...overrides,
  });
}

const claim = () => couponService.validateAndApplyCoupon(STORE_ID.toString(), 'SAVE10', 100);

// ── maxUses is enforced ─────────────────────────────────────────────────────

describe('maxUses enforcement', () => {
  it('refuses the redemption that would exceed maxUses', async () => {
    await makeCoupon({ maxUses: 2, expiresAt: FUTURE() });

    await claim();
    await claim();
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });

    const after = await Coupon.findOne({ code: 'SAVE10' }).lean();
    expect(after!.usedCount).toBe(2);
  });

  it('enforces maxUses even when the coupon has a future expiry', async () => {
    // The exact shape the flattened $or let through.
    await makeCoupon({ maxUses: 1, expiresAt: FUTURE() });

    await claim();
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('enforces maxUses when no expiry is set at all', async () => {
    await makeCoupon({ maxUses: 1 });

    await claim();
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses immediately when usedCount already equals maxUses', async () => {
    await makeCoupon({ maxUses: 3, usedCount: 3, expiresAt: FUTURE() });

    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
    const after = await Coupon.findOne({ code: 'SAVE10' }).lean();
    expect(after!.usedCount).toBe(3);
  });

  it('does not exceed maxUses under concurrent redemption', async () => {
    await makeCoupon({ maxUses: 3, expiresAt: FUTURE() });

    const results = await Promise.allSettled([claim(), claim(), claim(), claim(), claim()]);
    const ok = results.filter((r) => r.status === 'fulfilled');

    expect(ok).toHaveLength(3);
    const after = await Coupon.findOne({ code: 'SAVE10' }).lean();
    expect(after!.usedCount).toBe(3);
  });
});

// ── Unlimited coupons still work ────────────────────────────────────────────

describe('unlimited coupons (maxUses = 0)', () => {
  it('allows repeated redemption', async () => {
    await makeCoupon({ maxUses: 0, expiresAt: FUTURE() });

    for (let i = 0; i < 5; i++) await claim();

    const after = await Coupon.findOne({ code: 'SAVE10' }).lean();
    expect(after!.usedCount).toBe(5);
  });

  it('is still refused once expired', async () => {
    await makeCoupon({ maxUses: 0, expiresAt: PAST() });
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
  });
});

// ── Other guards unaffected ─────────────────────────────────────────────────

describe('other coupon guards', () => {
  it('refuses an inactive coupon', async () => {
    await makeCoupon({ isActive: false, expiresAt: FUTURE() });
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses below the minimum order amount', async () => {
    await makeCoupon({ minOrderAmount: 500, expiresAt: FUTURE() });
    await expect(claim()).rejects.toMatchObject({ statusCode: 400 });
  });

  it('404s for an unknown code', async () => {
    await expect(
      couponService.validateAndApplyCoupon(STORE_ID.toString(), 'NOPE', 100)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('computes a percent discount correctly', async () => {
    await makeCoupon({ type: 'percent', discount: 25, expiresAt: FUTURE() });
    const res = await claim();
    expect(res.discount).toBe(25);
  });

  it('caps a fixed discount at the subtotal', async () => {
    await makeCoupon({ type: 'fixed', discount: 500, expiresAt: FUTURE() });
    const res = await claim();
    expect(res.discount).toBe(100);
  });

  it('does not increment usedCount on a rejected claim', async () => {
    await makeCoupon({ minOrderAmount: 500, expiresAt: FUTURE() });
    await claim().catch(() => {});

    const after = await Coupon.findOne({ code: 'SAVE10' }).lean();
    expect(after!.usedCount).toBe(0);
  });
});
