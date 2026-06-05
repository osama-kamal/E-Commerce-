import { Request, Response, NextFunction } from 'express';
import * as wishlistService from './wishlist.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export async function getWishlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await wishlistService.getWishlist(getStoreId(req), req.user!.userId.toString());
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function addToWishlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await wishlistService.addToWishlist(
      getStoreId(req),
      req.user!.userId.toString(),
      req.params.productId
    );
    sendSuccess(res, result, 201);
  } catch (err) { next(err); }
}

export async function removeFromWishlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await wishlistService.removeFromWishlist(
      getStoreId(req),
      req.user!.userId.toString(),
      req.params.productId
    );
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function moveToCart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await wishlistService.moveToCart(
      getStoreId(req),
      req.user!.userId.toString(),
      req.params.productId
    );
    sendSuccess(res, result);
  } catch (err) { next(err); }
}
