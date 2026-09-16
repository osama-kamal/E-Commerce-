import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import * as taxService from './tax.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): Types.ObjectId {
  const storeId = req.store?._id;
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId as Types.ObjectId;
}

export async function listTaxRates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await taxService.listTaxRates(getStoreId(req)));
  } catch (err) { next(err); }
}

export async function createTaxRate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await taxService.createTaxRate(getStoreId(req), req.body), 201);
  } catch (err) { next(err); }
}

export async function updateTaxRate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await taxService.updateTaxRate(getStoreId(req), req.params.id, req.body));
  } catch (err) { next(err); }
}

export async function deleteTaxRate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await taxService.deleteTaxRate(getStoreId(req), req.params.id);
    sendSuccess(res, { deleted: true });
  } catch (err) { next(err); }
}
