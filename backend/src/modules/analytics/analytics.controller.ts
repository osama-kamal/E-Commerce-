import { Request, Response, NextFunction } from 'express';
import * as analyticsService from './analytics.service';
import { sendSuccess } from '../../utils/response';
import { parseDateRangeFromQuery } from '../../utils/dateRange';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export async function getSalesTrends(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e, granularity, categoryId } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const validGranularities = ['daily', 'weekly', 'monthly'];
    const selectedGranularity = granularity || 'daily';
    if (!validGranularities.includes(selectedGranularity)) {
      res.status(400).json({ success: false, code: 'INVALID_GRANULARITY', message: 'Granularity must be daily, weekly, or monthly' });
      return;
    }
    const result = await analyticsService.getSalesTrends({
      storeId: getStoreId(req),
      startDate,
      endDate,
      granularity: selectedGranularity as 'daily' | 'weekly' | 'monthly',
      categoryId,
    });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getCategoryPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const result = await analyticsService.getCategoryPerformance({ storeId: getStoreId(req), startDate, endDate });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getCustomerMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const result = await analyticsService.getCustomerMetrics({ storeId: getStoreId(req), startDate, endDate });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getAOVMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const result = await analyticsService.getAOVMetrics({ storeId: getStoreId(req), startDate, endDate });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getConversionMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const result = await analyticsService.getConversionMetrics({ storeId: getStoreId(req), startDate, endDate });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getTodayMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await analyticsService.getTodayMetrics(getStoreId(req));
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getRecentOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const result = await analyticsService.getRecentOrders(getStoreId(req), limit);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getRevenueGoal(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const period = (req.query.period as string) || 'monthly';
    const validPeriods = ['daily', 'weekly', 'monthly'];
    if (!validPeriods.includes(period)) {
      res.status(400).json({ success: false, code: 'INVALID_PERIOD', message: 'Period must be daily, weekly, or monthly' });
      return;
    }
    const result = await analyticsService.getRevenueGoal(getStoreId(req), period as 'daily' | 'weekly' | 'monthly');
    sendSuccess(res, result);
  } catch (err) { next(err); }
}
