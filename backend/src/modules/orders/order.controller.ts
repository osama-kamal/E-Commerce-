import { Request, Response, NextFunction } from 'express';
import * as orderService from './order.service';
import { sendSuccess } from '../../utils/response';
import { OrderStatus } from './order.model';
import { logger } from '../../utils/logger';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): string {
  // Prefer the store resolved from the current request's X-Store-ID header (req.store)
  // over the storeId embedded in the JWT (req.user.storeId).
  // req.store is set by resolveStore middleware from the X-Store-ID header on every request
  // and is the authoritative tenant context. The JWT storeId is set at login time and can
  // become stale if the user's store context changes between requests.
  const storeId = req.store?._id?.toString() ?? req.user?.storeId?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
}

// ── Customer handlers ──────────────────────────────────────────────────────────

/**
 * Checkout-failure diagnostics with the customer's address stripped out.
 *
 * The failure log used to carry `req.body` verbatim, which put the shopper's
 * street, city and postcode — alongside their `userId` — into a persistent log
 * file on every failed checkout. That is personal data under GDPR, retained
 * indefinitely, in a file nobody treats as a customer record.
 *
 * None of it was needed to debug a checkout. What actually diagnoses these
 * failures is the SHAPE of the request, so that is what is kept:
 *
 *   • which address fields arrived — a missing `country` or `postalCode` is a
 *     common cause of DESTINATION_NOT_SERVED and of tax-rate resolution
 *     returning nothing
 *   • `country` by value, because shipping-zone and tax-rate matching key on it
 *     and it does not identify anybody on its own
 *   • the non-PII controls: payment method, whether a coupon was tried, whether
 *     a delivery method was chosen, whether an idempotency key was sent
 *
 * Coupon CODE is kept — it is a shared promotional token, not personal data,
 * and "which coupon broke checkout" is usually the question being asked.
 */
function redactCheckoutBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return { bodyPresent: false };

  const { shippingAddress, paymentMethod, couponCode, idempotencyKey, shippingRateId } =
    body as Record<string, unknown>;

  const address = (shippingAddress ?? {}) as Record<string, unknown>;
  const present = (field: string) =>
    typeof address[field] === 'string' && (address[field] as string).trim() !== '';

  return {
    paymentMethod,
    couponCode,
    shippingRateId,
    hasIdempotencyKey: Boolean(idempotencyKey),
    shippingAddress: shippingAddress
      ? {
          // Values withheld — presence only. See the header.
          country: address.country,
          fieldsPresent: ['line1', 'city', 'state', 'postalCode', 'country'].filter(present),
        }
      : null,
  };
}

export async function placeOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerId = req.user!.userId.toString();
    // `discountAmount` is intentionally NOT read from the body — the discount is
    // resolved server-side from `couponCode` inside placeOrder.
    const { shippingAddress, paymentMethod = 'online', couponCode, idempotencyKey, shippingRateId } = req.body;
    const order = await orderService.placeOrder(
      getStoreId(req), customerId, shippingAddress, paymentMethod, couponCode, idempotencyKey, shippingRateId
    );
    sendSuccess(res, order, 201);
  } catch (err) {
    logger.error('[placeOrder] Failed to place order', {
      error: err,
      request: redactCheckoutBody(req.body),
      userId: req.user?.userId,
    });
    next(err);
  }
}

export async function getMyOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerId = req.user!.userId.toString();
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const result = await orderService.getMyOrders(getStoreId(req), customerId, page, limit);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function getMyOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerId = req.user!.userId.toString();
    const order = await orderService.getMyOrderById(getStoreId(req), customerId, req.params.id);
    sendSuccess(res, order);
  } catch (err) { next(err); }
}

export async function cancelMyOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const customerId = req.user!.userId.toString();
    const order = await orderService.cancelMyOrder(getStoreId(req), customerId, req.params.id);
    sendSuccess(res, order);
  } catch (err) { next(err); }
}

// ── Admin handlers ─────────────────────────────────────────────────────────────

export async function getAllOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const status = req.query.status as OrderStatus | undefined;
    const result = await orderService.getAllOrders(getStoreId(req), page, limit, status);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

export async function updateOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { status } = req.body as { status: OrderStatus };
    const order = await orderService.updateOrderStatus(getStoreId(req), req.params.id, status);
    sendSuccess(res, order);
  } catch (err) { next(err); }
}

export async function bulkUpdateOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids, status } = req.body as { ids: string[]; status: OrderStatus };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: 'ids array is required' });
      return;
    }
    if (!status) {
      res.status(400).json({ success: false, message: 'status is required' });
      return;
    }
    const count = await orderService.bulkUpdateOrderStatus(getStoreId(req), ids, status);
    sendSuccess(res, { updatedCount: count, message: `${count} orders updated to ${status}` });
  } catch (err) { next(err); }
}

export async function bulkDeleteOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ success: false, message: 'ids array is required' });
      return;
    }
    const count = await orderService.bulkDeleteOrders(getStoreId(req), ids);
    sendSuccess(res, { deletedCount: count, message: `${count} orders deleted` });
  } catch (err) { next(err); }
}
