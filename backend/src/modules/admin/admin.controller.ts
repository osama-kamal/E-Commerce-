import { Request, Response, NextFunction } from 'express';
import * as adminService from './admin.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

export async function getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const stats = await adminService.getDashboardStats(
      getStoreId(req),
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    sendSuccess(res, stats);
  } catch (err) { next(err); }
}

export async function getTopProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { startDate, endDate, limit } = req.query as {
      startDate?: string;
      endDate?: string;
      limit?: string;
    };
    const products = await adminService.getTopProducts(
      getStoreId(req),
      limit ? Number(limit) : 10,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    sendSuccess(res, products);
  } catch (err) { next(err); }
}

export async function listUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const role = req.query.role as 'admin' | 'customer' | undefined;
    const result = await adminService.listUsers(getStoreId(req), page, limit, role);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getUserById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await adminService.getUserById(getStoreId(req), req.params.id);
    sendSuccess(res, user);
  } catch (err) { next(err); }
}

export async function toggleUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { isActive } = req.body as { isActive: boolean };
    const user = await adminService.toggleUserStatus(getStoreId(req), req.params.id, isActive);
    sendSuccess(res, user);
  } catch (err) { next(err); }
}

export async function updateUserRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role } = req.body as { role: 'admin' | 'customer' };
    const user = await adminService.updateUserRole(getStoreId(req), req.params.id, role);
    sendSuccess(res, user);
  } catch (err) { next(err); }
}

export async function filterOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { page, limit, status, userId, startDate, endDate } = req.query as Record<string, string>;
    const result = await adminService.filterOrders({
      storeId: getStoreId(req),
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      status,
      userId,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getLowStockProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const threshold = Number(req.query.threshold) || 10;
    const result = await adminService.getLowStockProducts(getStoreId(req), threshold);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ── Super-admin: update store plan ────────────────────────────────────────────

export async function updateStorePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { plan, status } = req.body as { plan: string; status: string };

    const validPlans = ['free', 'starter', 'pro', 'enterprise'];
    const validStatuses = ['active', 'trialing', 'past_due', 'cancelled', 'suspended'];

    if (!plan || !validPlans.includes(plan)) {
      return next(createError(`plan must be one of: ${validPlans.join(', ')}`, 400, 'BAD_REQUEST'));
    }
    if (!status || !validStatuses.includes(status)) {
      return next(createError(`status must be one of: ${validStatuses.join(', ')}`, 400, 'BAD_REQUEST'));
    }

    const { updateStorePlan: updatePlan } = await import('../stores/store.service');
    const store = await updatePlan(id, plan as any, status as any);
    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Super-admin: list all stores ──────────────────────────────────────────────

export async function listAllStoresAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 50;
    const { listAllStores } = await import('../stores/store.service');
    const result = await listAllStores(page, limit);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}
