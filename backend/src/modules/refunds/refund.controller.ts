import { Request, Response, NextFunction } from 'express';
import * as refundService from './refund.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

/** What a refund WOULD return. Moves no money. */
export async function previewRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await refundService.previewRefund(getStoreId(req), req.params.id, req.body);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function createRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refund = await refundService.createRefund(
      getStoreId(req),
      req.params.id,
      req.body,
      // Recorded on the refund so there is an audit trail of who returned the
      // money — this is the one place in the app that moves funds outward.
      req.user!.userId
    );
    sendSuccess(res, refund, 201);
  } catch (err) { next(err); }
}

export async function listOrderRefunds(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refunds = await refundService.listOrderRefunds(getStoreId(req), req.params.id);
    sendSuccess(res, refunds);
  } catch (err) { next(err); }
}
