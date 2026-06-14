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

export async function findRecentPendingOrder(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  totalAmount: number,
  since: Date
) {
  return Order.findOne({
    storeId,
    customerId,
    status: 'pending',
    totalAmount,
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
  return Order.updateMany({ _id: { $in: ids }, storeId }, { status });
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
