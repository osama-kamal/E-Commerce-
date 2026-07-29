import { Request, Response, NextFunction } from 'express';
import * as reviewService from './review.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export async function getProductReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await reviewService.getProductReviews(
      getStoreId(req),
      req.params.productId,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function submitReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerId = req.user!.userId.toString();
    const { productId } = req.params;
    const { rating, comment } = req.body as { rating: number; comment: string };
    const review = await reviewService.submitReview(getStoreId(req), customerId, productId, rating, comment);
    sendSuccess(res, review, 201);
  } catch (err) { next(err); }
}

export async function deleteReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await reviewService.softDeleteReview(getStoreId(req), req.params.id);
    sendSuccess(res, { message: 'Review deleted' });
  } catch (err) { next(err); }
}
