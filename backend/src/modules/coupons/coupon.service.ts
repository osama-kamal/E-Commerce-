import { ClientSession, Types } from 'mongoose';
import { Coupon, ICoupon } from './coupon.model';
import { createError } from '../../middleware/errorHandler';

export interface ValidateCouponResult {
  discount: number;
  label: string;
  code: string;
}

export const couponService = {
  /**
   * Atomically validates AND increments usedCount in a single findOneAndUpdate.
   * This eliminates the TOCTOU race condition where two concurrent requests
   * both pass validation before either increments the counter (item #16).
   *
   * The update only proceeds when ALL conditions are met in the filter:
   *   - coupon exists and belongs to the store
   *   - isActive = true
   *   - not expired
   *   - usedCount < maxUses (or maxUses = 0 = unlimited)
   *
   * Returns null if the coupon doesn't exist or any condition fails.
   */
  async validateAndApplyCoupon(
    storeId: string,
    code: string,
    subtotal: number,
    session?: ClientSession
  ): Promise<ValidateCouponResult> {
    const normalizedCode = code.toUpperCase().trim();
    const now = new Date();

    // First, fetch to get the current coupon state for discount calculation.
    // Runs inside the caller's transaction when a session is supplied so the
    // read and the claim below observe a consistent snapshot.
    const couponQuery = Coupon.findOne({
      storeId: new Types.ObjectId(storeId),
      code: normalizedCode,
    });
    if (session) couponQuery.session(session);
    const coupon = await couponQuery;

    if (!coupon) throw createError('Coupon code not found', 404, 'NOT_FOUND');
    if (!coupon.isActive) throw createError('This coupon is no longer active', 400, 'BAD_REQUEST');
    if (coupon.expiresAt && coupon.expiresAt < now) throw createError('This coupon has expired', 400, 'BAD_REQUEST');
    if (subtotal < coupon.minOrderAmount) {
      throw createError(`This coupon requires a minimum order of $${coupon.minOrderAmount.toFixed(2)}`, 400, 'BAD_REQUEST');
    }

    // Atomic increment: only applies if maxUses not yet reached.
    // If maxUses = 0, the condition $or ensures it always passes.
    // This is the single DB operation that both validates and claims the usage.
    const claimed = await Coupon.findOneAndUpdate(
      {
        storeId: new Types.ObjectId(storeId),
        code: normalizedCode,
        isActive: true,
        // Expiry and usage are INDEPENDENT requirements — both must hold, so they
        // are two $or groups combined with $and.
        //
        // These were previously flattened into one $or, which any single branch
        // satisfied: a coupon with a future expiry matched on the expiry branch
        // alone and `maxUses` was never checked, so a limited promotion could be
        // redeemed without bound.
        $and: [
          // Not expired (or no expiry set)
          {
            $or: [
              { expiresAt: { $gt: now } },
              { expiresAt: { $exists: false } },
              { expiresAt: null },
            ],
          },
          // Unlimited uses (maxUses = 0) or still has uses left
          {
            $or: [
              { maxUses: 0 },
              { $expr: { $lt: ['$usedCount', '$maxUses'] } },
            ],
          },
        ],
      },
      { $inc: { usedCount: 1 } },
      // Return the pre-update doc to verify. When a session is supplied the
      // increment participates in the caller's transaction, so an aborted
      // checkout rolls the usage claim back automatically.
      { new: false, ...(session ? { session } : {}) }
    );

    if (!claimed) {
      throw createError('This coupon has reached its maximum number of uses', 400, 'BAD_REQUEST');
    }

    // Calculate discount amount
    let discountAmount: number;
    let label: string;

    if (coupon.type === 'percent') {
      discountAmount = Math.round(subtotal * (coupon.discount / 100) * 100) / 100;
      label = `${coupon.discount}% off`;
    } else {
      discountAmount = Math.min(coupon.discount, subtotal);
      label = `$${coupon.discount.toFixed(2)} off`;
    }

    return { discount: discountAmount, label, code: coupon.code };
  },

  /**
   * @deprecated Use validateAndApplyCoupon which is atomic.
   * Kept for any callers that only need to increment without re-validating.
   */
  async applyCoupon(storeId: string, code: string): Promise<void> {
    await Coupon.findOneAndUpdate(
      { storeId: new Types.ObjectId(storeId), code: code.toUpperCase().trim() },
      { $inc: { usedCount: 1 } }
    );
  },

  /**
   * Read-only validation — does NOT increment usedCount.
   * Use this only for preview/UI purposes. Use validateAndApplyCoupon at checkout.
   */
  async validateCoupon(storeId: string, code: string, subtotal: number): Promise<ValidateCouponResult> {
    const normalizedCode = code.toUpperCase().trim();
    const now = new Date();

    const coupon = await Coupon.findOne({
      storeId: new Types.ObjectId(storeId),
      code: normalizedCode,
    });

    if (!coupon) throw createError('Coupon code not found', 404, 'NOT_FOUND');
    if (!coupon.isActive) throw createError('This coupon is no longer active', 400, 'BAD_REQUEST');
    if (coupon.expiresAt && coupon.expiresAt < now) throw createError('This coupon has expired', 400, 'BAD_REQUEST');
    if (subtotal < coupon.minOrderAmount) {
      throw createError(`This coupon requires a minimum order of $${coupon.minOrderAmount.toFixed(2)}`, 400, 'BAD_REQUEST');
    }
    if (coupon.maxUses > 0 && coupon.usedCount >= coupon.maxUses) {
      throw createError('This coupon has reached its maximum number of uses', 400, 'BAD_REQUEST');
    }

    let discountAmount: number;
    let label: string;

    if (coupon.type === 'percent') {
      discountAmount = Math.round(subtotal * (coupon.discount / 100) * 100) / 100;
      label = `${coupon.discount}% off`;
    } else {
      discountAmount = Math.min(coupon.discount, subtotal);
      label = `$${coupon.discount.toFixed(2)} off`;
    }

    return { discount: discountAmount, label, code: coupon.code };
  },

  async createCoupon(storeId: string, data: Partial<ICoupon>): Promise<ICoupon> {
    const coupon = new Coupon({ ...data, storeId: new Types.ObjectId(storeId) });
    return coupon.save();
  },

  async listCoupons(storeId: string): Promise<ICoupon[]> {
    return Coupon.find({ storeId: new Types.ObjectId(storeId) }).sort({ createdAt: -1 });
  },

  async updateCoupon(storeId: string, id: string, data: Partial<ICoupon>): Promise<ICoupon | null> {
    return Coupon.findOneAndUpdate(
      { _id: id, storeId: new Types.ObjectId(storeId) },
      data,
      { new: true, runValidators: true }
    );
  },

  async deleteCoupon(storeId: string, id: string): Promise<ICoupon | null> {
    return Coupon.findOneAndDelete({ _id: id, storeId: new Types.ObjectId(storeId) });
  },
};
