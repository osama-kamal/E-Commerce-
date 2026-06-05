import { Request, Response, NextFunction } from 'express';
import * as reportsService from './reports.service';
import { sendSuccess } from '../../utils/response';
import { parseDateRangeFromQuery } from '../../utils/dateRange';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export async function getInventoryReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, page, limit, search } = req.query as Record<string, string>;
    const validStatuses = ['low', 'out', 'overstocked', 'all'];
    const selectedStatus = status || 'all';
    if (!validStatuses.includes(selectedStatus)) {
      res.status(400).json({ success: false, code: 'INVALID_STATUS', message: 'Status must be low, out, overstocked, or all' });
      return;
    }
    const result = await reportsService.getInventoryReport({
      storeId: getStoreId(req),
      status: selectedStatus as 'low' | 'out' | 'overstocked' | 'all',
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(Math.max(1, Number(limit) || 50), 100),
      search: search || undefined,
    });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getSalesReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e, page, limit, search } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const result = await reportsService.getSalesReport({
      storeId: getStoreId(req),
      startDate,
      endDate,
      page: Math.max(1, Number(page) || 1),
      limit: Math.min(Math.max(1, Number(limit) || 50), 100),
      search: search || undefined,
    });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function exportSalesReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const csvData = await reportsService.exportSalesReport({ storeId: getStoreId(req), startDate, endDate });
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sales-report-${startStr}-${endStr}.csv"`);
    res.send(csvData);
  } catch (err) { next(err); }
}

export async function exportInventoryReport(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status, search } = req.query as Record<string, string>;
    const validStatuses = ['low', 'out', 'overstocked', 'all'];
    const selectedStatus = status || 'all';
    if (!validStatuses.includes(selectedStatus)) {
      res.status(400).json({ success: false, code: 'INVALID_STATUS', message: 'Status must be low, out, overstocked, or all' });
      return;
    }
    const result = await reportsService.getInventoryReport({
      storeId: getStoreId(req),
      status: selectedStatus as 'low' | 'out' | 'overstocked' | 'all',
      page: 1,
      limit: 10000,
      search: search || undefined,
    });

    const escape = (v: any) => {
      const s = String(v ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const rows = [
      ['Product Name', 'Category', 'Stock', 'Status'].join(','),
      ...result.products.map(p => [escape(p.productName), escape(p.categoryName), escape(p.stock), escape(p.status)].join(',')),
    ];

    const timestamp = new Date().toISOString().split('T')[0];
    const suffix = selectedStatus !== 'all' ? `-${selectedStatus}` : '';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-report${suffix}-${timestamp}.csv"`);
    res.send(rows.join('\n'));
  } catch (err) { next(err); }
}

export async function getProductPerformance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate: s, endDate: e, type, limit } = req.query as Record<string, string>;
    const { startDate, endDate } = parseDateRangeFromQuery(s, e);
    const validTypes = ['best', 'worst'];
    const selectedType = type || 'best';
    if (!validTypes.includes(selectedType)) {
      res.status(400).json({ success: false, code: 'INVALID_TYPE', message: 'Type must be best or worst' });
      return;
    }
    const result = await reportsService.getProductPerformance({
      storeId: getStoreId(req),
      startDate,
      endDate,
      type: selectedType as 'best' | 'worst',
      limit: Math.min(Math.max(1, Number(limit) || 10), 50),
    });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}
