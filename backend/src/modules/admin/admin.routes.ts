import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  dateRangeSchema,
  paginationSchema,
  userIdParamSchema,
  toggleStatusSchema,
  updateRoleSchema,
  orderFilterSchema,
} from './admin.schemas';
import {
  getDashboard,
  getTopProducts,
  listUsers,
  getUserById,
  toggleUserStatus,
  updateUserRole,
  filterOrders,
  getLowStockProducts,
} from './admin.controller';

const router = Router();

// All admin routes require authentication + admin role
router.use(authenticateJWT, authorizeRole('admin'));

// ── Analytics ──────────────────────────────────────────────────────────────────
router.get('/dashboard', validate(dateRangeSchema), getDashboard);
router.get('/top-products', validate(dateRangeSchema), getTopProducts);

// ── User management ────────────────────────────────────────────────────────────
router.get('/users', validate(paginationSchema), listUsers);
router.get('/users/:id', validate(userIdParamSchema), getUserById);
router.put('/users/:id/status', validate(toggleStatusSchema), toggleUserStatus);
router.put('/users/:id/role', validate(updateRoleSchema), updateUserRole);

// ── Advanced order management ──────────────────────────────────────────────────
router.get('/orders', validate(orderFilterSchema), filterOrders);

// ── Inventory alerts ───────────────────────────────────────────────────────────
router.get('/low-stock', getLowStockProducts);

// NOTE: the platform-scoped store routes (PATCH /stores/:id/plan, GET /stores)
// are deliberately NOT registered here. This router is mounted behind
// `authorizeRole('admin')`, which every store owner satisfies. Those endpoints
// live on the super-admin-guarded router in app.ts instead.

export default router;
