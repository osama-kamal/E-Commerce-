import { Request, Response } from 'express';
import { couponService } from './coupon.service';
import { sendSuccess, sendError } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export const couponController = {
  async validate(req: Request, res: Response) {
    try {
      const { code, subtotal } = req.body;
      if (!code || typeof code !== 'string') {
        return sendError(res, 'VALIDATION_ERROR', 'Coupon code is required', 400);
      }
      if (subtotal === undefined || typeof subtotal !== 'number' || subtotal < 0) {
        return sendError(res, 'VALIDATION_ERROR', 'Valid subtotal is required', 400);
      }
      const result = await couponService.validateCoupon(getStoreId(req), code, subtotal);
      return sendSuccess(res, result);
    } catch (err: any) {
      return sendError(res, 'COUPON_INVALID', err.message, 400);
    }
  },

  async list(req: Request, res: Response) {
    try {
      const coupons = await couponService.listCoupons(getStoreId(req));
      return sendSuccess(res, coupons);
    } catch (err: any) {
      return sendError(res, 'FETCH_ERROR', err.message, 500);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const coupon = await couponService.createCoupon(getStoreId(req), req.body);
      return sendSuccess(res, coupon, 201);
    } catch (err: any) {
      if (err.code === 11000) {
        return sendError(res, 'DUPLICATE_CODE', 'A coupon with this code already exists in this store', 409);
      }
      return sendError(res, 'CREATE_ERROR', err.message, 400);
    }
  },

  async update(req: Request, res: Response) {
    try {
      const coupon = await couponService.updateCoupon(getStoreId(req), req.params.id, req.body);
      if (!coupon) return sendError(res, 'NOT_FOUND', 'Coupon not found', 404);
      return sendSuccess(res, coupon);
    } catch (err: any) {
      return sendError(res, 'UPDATE_ERROR', err.message, 400);
    }
  },

  async remove(req: Request, res: Response) {
    try {
      const coupon = await couponService.deleteCoupon(getStoreId(req), req.params.id);
      if (!coupon) return sendError(res, 'NOT_FOUND', 'Coupon not found', 404);
      return sendSuccess(res, { message: 'Coupon deleted successfully' });
    } catch (err: any) {
      return sendError(res, 'DELETE_ERROR', err.message, 500);
    }
  },
};
