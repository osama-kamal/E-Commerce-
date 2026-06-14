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
    const { plan, status, endsAt } = req.body as { plan: string; status: string; endsAt?: string };

    const validPlans = ['free', 'starter', 'pro', 'enterprise'];
    const validStatuses = ['active', 'trialing', 'past_due', 'cancelled', 'suspended', 'pending_upgrade'];

    if (!plan || !validPlans.includes(plan)) {
      return next(createError(`plan must be one of: ${validPlans.join(', ')}`, 400, 'BAD_REQUEST'));
    }
    if (!status || !validStatuses.includes(status)) {
      return next(createError(`status must be one of: ${validStatuses.join(', ')}`, 400, 'BAD_REQUEST'));
    }

    const { Store } = await import('../stores/store.model');
    const updateFields: Record<string, unknown> = {
      subscriptionPlan: plan,
      subscriptionStatus: status,
      $unset: { requestedPlan: '' },
    };

    if (endsAt) {
      const parsed = new Date(endsAt);
      if (!isNaN(parsed.getTime())) {
        updateFields.subscriptionEndsAt = parsed;
      }
    }

    const store = await Store.findByIdAndUpdate(id, updateFields, { new: true, runValidators: true }).lean();
    if (!store) return next(createError('Store not found', 404, 'NOT_FOUND'));

    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Super-admin: list stores with pending upgrade requests ───────────────────

export async function listPendingUpgrades(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { Store } = await import('../stores/store.model');
    const { User } = await import('../auth/user.model');

    // Catch both cases:
    //  - trialing/free stores: status flipped to pending_upgrade
    //  - active stores: status kept as active, requestedPlan set to flag the request
    const pending = await Store.find({
      requestedPlan: { $exists: true, $ne: null },
    })
      .sort({ updatedAt: -1 })
      .lean();

    // Enrich with owner email so the platform admin can identify who to contact
    const ownerIds = [...new Set(pending.map(s => s.ownerId?.toString()).filter(Boolean))];
    const owners = await User.find({ _id: { $in: ownerIds } })
      .select('_id email')
      .lean();
    const ownerMap = new Map(owners.map(u => [u._id.toString(), u]));

    const now = Date.now();
    const enriched = pending.map(store => {
      const endsAt = (store as any).subscriptionEndsAt
        ? new Date((store as any).subscriptionEndsAt)
        : null;
      const daysRemaining = endsAt
        ? Math.max(0, Math.ceil((endsAt.getTime() - now) / 86_400_000))
        : null;

      return {
        ...store,
        ownerEmail: ownerMap.get(store.ownerId?.toString())?.email ?? null,
        ownerName: null,
        subscriptionEndsAt: endsAt ? endsAt.toISOString() : null,
        daysRemaining,
      };
    });

    sendSuccess(res, enriched);
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
