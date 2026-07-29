import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  placeOrderSchema,
  orderIdSchema,
  paginationSchema,
  updateStatusSchema,
  bulkUpdateStatusSchema,
  bulkDeleteOrdersSchema,
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

// ⚠️  ORDER MATTERS — the bulk routes MUST be registered before '/admin/:id/status'.
// '/admin/:id/status' and '/admin/bulk/status' both have three path segments, so
// the parameterised route matches '/admin/bulk/status' with id === 'bulk'. When it
// was registered first it swallowed every bulk request, which then failed with
// "Invalid order ID" — the bulk status feature never worked.
router.put(
  '/admin/bulk/status',
  authenticateJWT,
  authorizeRole('admin'),
  validate(bulkUpdateStatusSchema),
  bulkUpdateOrderStatus
);

router.delete(
  '/admin/bulk/delete',
  authenticateJWT,
  authorizeRole('admin'),
  validate(bulkDeleteOrdersSchema),
  bulkDeleteOrders
);

router.put(
  '/admin/:id/status',
  authenticateJWT,
  authorizeRole('admin'),
  validate(updateStatusSchema),
  updateOrderStatus
);

export default router;
