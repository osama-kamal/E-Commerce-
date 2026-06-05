import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  placeOrderSchema,
  orderIdSchema,
  paginationSchema,
  updateStatusSchema,
} from './order.schemas';
import {
  placeOrder,
  getMyOrders,
  getMyOrderById,
  cancelMyOrder,
  getAllOrders,
  updateOrderStatus,
  bulkUpdateOrderStatus,
  bulkDeleteOrders,
} from './order.controller';

const router = Router();

// ── Customer routes ────────────────────────────────────────────────────────────
router.post(
  '/',
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(placeOrderSchema),
  placeOrder
);

router.get(
  '/',
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(paginationSchema),
  getMyOrders
);

router.get(
  '/:id',
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(orderIdSchema),
  getMyOrderById
);

router.put(
  '/:id/cancel',
  authenticateJWT,
  authorizeRole('customer', 'admin'),
  validate(orderIdSchema),
  cancelMyOrder
);

// ── Admin routes ───────────────────────────────────────────────────────────────
router.get(
  '/admin/all',
  authenticateJWT,
  authorizeRole('admin'),
  validate(paginationSchema),
  getAllOrders
);

router.put(
  '/admin/:id/status',
  authenticateJWT,
  authorizeRole('admin'),
  validate(updateStatusSchema),
  updateOrderStatus
);

router.put(
  '/admin/bulk/status',
  authenticateJWT,
  authorizeRole('admin'),
  bulkUpdateOrderStatus
);

router.delete(
  '/admin/bulk/delete',
  authenticateJWT,
  authorizeRole('admin'),
  bulkDeleteOrders
);

export default router;
