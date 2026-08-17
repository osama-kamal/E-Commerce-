/**
 * OrderRepository
 *
 * Owns all direct Mongoose queries for the Order collection.
 * Services import from here — not from the model directly.
 * No business logic lives here; only data access.
 */

import { ClientSession, Types } from 'mongoose';
import { Order, IOrder, OrderStatus } from './order.model';

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function findOrderByIdempotencyKey(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  idempotencyKey: string
) {
  return Order.findOne({ storeId, customerId, idempotencyKey }).lean();
}

/**
 * Fallback duplicate-submit guard.
 *
 * Matches on `subtotal` rather than `totalAmount`: the grand total now moves
 * with the chosen delivery method and destination tax, so two submissions of
 * the same basket can legitimately differ there. The subtotal identifies the
 * basket itself.
 */
export async function findRecentPendingOrder(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  subtotal: number,
  since: Date
) {
  return Order.findOne({
    storeId,
    customerId,
    status: 'pending',
    subtotal,
    createdAt: { $gte: since },
  }).select('_id').lean();
}

export async function findOrderById(id: string, storeId: Types.ObjectId) {
  return Order.findOne({ _id: id, storeId }).lean();
}

export async function findOrderByIdForCustomer(
  id: string,
  storeId: Types.ObjectId,
  customerId: Types.ObjectId
) {
  return Order.findOne({ _id: id, storeId, customerId }).lean();
}

/** Returns a live Mongoose document (not lean) — needed for `save()` calls. */
export async function findOrderDocumentById(id: string, storeId: Types.ObjectId) {
  return Order.findOne({ _id: id, storeId });
}

export async function findOrderDocumentByIdForCustomer(
  id: string,
  storeId: Types.ObjectId,
  customerId: Types.ObjectId
) {
  return Order.findOne({ _id: id, storeId, customerId });
}

export async function findCustomerOrders(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  skip: number,
  limit: number
) {
  const query = { storeId, customerId };
  const [data, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('_id storeId customerId items totalAmount discountAmount status createdAt updatedAt shippingAddress')
      .lean(),
    Order.countDocuments(query),
  ]);
  return { data, total };
}

export async function findStoreOrders(
  storeId: Types.ObjectId,
  skip: number,
  limit: number,
  status?: OrderStatus
) {
  const query: Record<string, unknown> = { storeId };
  if (status) query.status = status;
  const [data, total] = await Promise.all([
    Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Order.countDocuments(query),
  ]);
  return { data, total };
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createOrder(
  data: Partial<IOrder>,
  session?: ClientSession
) {
  if (session) {
    const [order] = await Order.create([data], { session });
    return order;
  }
  return Order.create(data);
}

export async function bulkUpdateOrderStatuses(
  ids: Types.ObjectId[],
  storeId: Types.ObjectId,
  status: OrderStatus
) {
  // runValidators makes Mongoose enforce the status enum on this update.
  // Without it, updateMany writes whatever string it is given.
  return Order.updateMany(
    { _id: { $in: ids }, storeId },
    { status },
    { runValidators: true }
  );
}

export async function deleteOrdersByIds(ids: Types.ObjectId[], storeId: Types.ObjectId): Promise<{ deletedCount: number }> {
  return Order.deleteMany({ _id: { $in: ids }, storeId }) as unknown as Promise<{ deletedCount: number }>;
}

export async function clearCartAfterOrder(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  session?: ClientSession
) {
  // Imported lazily to avoid circular dep — Cart lives in cart module
  const { Cart } = await import('../cart/cart.model');
  const q = Cart.updateOne({ storeId, customerId }, { $set: { items: [] } });
  if (session) q.session(session);
  return q;
}

// ── Payment integration helpers ───────────────────────────────────────────────

/** Used by createPaymentIntent — find a pending order scoped to customer + store. */
export async function findPendingOrderForPayment(
  orderId: string,
  customerId: Types.ObjectId,
  storeId: Types.ObjectId
) {
  return Order.findOne({
    _id: orderId,
    customerId,
    storeId,
  }).lean();
}

/** Attach the Stripe PaymentIntent ID to an order for later reconciliation. */
export async function attachPaymentIntentId(orderId: string, paymentIntentId: string) {
  return Order.updateOne({ _id: orderId }, { paymentIntentId });
}

/**
 * Orders a store has taken in the current calendar month, for plan-quota checks.
 *
 * Cancelled orders are excluded so an abandoned or auto-expired checkout does
 * not consume the merchant's allowance.
 */
export async function countOrdersSince(storeId: Types.ObjectId, since: Date): Promise<number> {
  return Order.countDocuments({
    storeId,
    createdAt: { $gte: since },
    status: { $ne: 'cancelled' },
  });
}

/**
 * Online orders left pending past the reservation window.
 *
 * Deliberately excludes paymentMethod 'cod' — those sit pending by design until
 * a human fulfils them and must never be auto-cancelled.
 */
export async function findStalePendingOnlineOrders(cutoff: Date, limit = 200) {
  return Order.find({
    status: 'pending',
    paymentMethod: 'online',
    createdAt: { $lt: cutoff },
  })
    .select('_id storeId items')
    .limit(limit)
    .lean();
}

/**
 * Atomically move an order to `to`, but only if it is currently exactly `from`.
 *
 * Returns the updated document, or null if the order had already moved on. The
 * status term in the filter makes the transition at-most-once under concurrency,
 * which is what allows the caller to restore stock exactly once on cancellation.
 */
export async function transitionOrderStatus(
  orderId: string,
  storeId: Types.ObjectId,
  from: OrderStatus,
  to: OrderStatus,
  customerId?: Types.ObjectId
) {
  const filter: Record<string, unknown> = { _id: orderId, storeId, status: from };
  if (customerId) filter.customerId = customerId;

  return Order.findOneAndUpdate(filter, { $set: { status: to } }, { new: true });
}

/**
 * Atomically advance a pending order to 'processing'.
 *
 * Returns true only for the caller that actually performed the transition, so
 * concurrent webhook deliveries cannot both send a receipt email. The
 * `status: 'pending'` term in the filter also prevents a late or replayed event
 * from resurrecting a cancelled or already-fulfilled order.
 */
export async function markOrderProcessingIfPending(orderId: string): Promise<boolean> {
  const res = await Order.updateOne(
    { _id: orderId, status: 'pending' },
    // Both axes move together here, and only here: this is the moment the money
    // actually arrived. Without setting `paymentStatus` the order would advance
    // through fulfilment while still reading `unpaid`, and the refund service
    // would refuse to return money that had genuinely been taken.
    { $set: { status: 'processing', paymentStatus: 'paid' } }
  );
  return res.modifiedCount === 1;
}

/** Find a live order document by orderId only (no storeId constraint).
 *  Use only in trusted server-side contexts like payment webhooks
 *  where the storeId is not available but the source is already verified. */
export async function findOrderDocumentByOrderIdOnly(orderId: string) {
  return Order.findById(orderId);
}
