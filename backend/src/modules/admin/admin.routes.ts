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
  updateStorePlan,
  listAllStoresAdmin,
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

// ── Store plan management (super-admin) ───────────────────────────────────────
router.patch('/stores/:id/plan', updateStorePlan);
router.get('/stores', listAllStoresAdmin);

export default router;
