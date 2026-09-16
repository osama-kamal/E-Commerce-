import { Types } from 'mongoose';
import { Order, derivePaymentStatus } from '../orders/order.model';
import { Payment } from '../payments/payment.model';
import { Refund, IRefund, RefundProvider } from './refund.model';
import {
  calculateRefund,
  buildFullRefundLines,
  RefundBreakdown,
  RefundRequestLine,
  RefundValidationError,
  RefundableOrder,
} from './refund-math';
import { paymentProviderFactory } from '../payments/providers/payment-provider.factory';
import { RefundNotSupportedError } from '../payments/providers/payment-provider.interface';
import { toMinorUnits } from '../checkout/currency';
import * as productRepo from '../products/product.repository';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { emailService } from '../../services/email.service';

/**
 * Refund issuance.
 *
 * ── The ordering problem ──────────────────────────────────────────────────────
 * A refund touches two systems that cannot be updated atomically: the payment
 * gateway and our database. Whichever goes first, the other can fail:
 *
 *   provider first → gateway refunds, DB write fails → money gone, no record,
 *                    and the merchant can refund again on the next attempt
 *   database first → DB says refunded, gateway rejects → order looks refunded
 *                    while the customer never got their money
 *
 * Neither is acceptable, so this uses a reservation:
 *
 *   1. RESERVE  — atomically add the amount to `order.refundedTotal`, but only
 *                 if the result stays within `totalAmount`. This is the
 *                 concurrency gate: two admins refunding at once cannot
 *                 together exceed the order, because the second conditional
 *                 update simply fails to match.
 *   2. RECORD   — write the Refund as `pending`, so a crash after this point
 *                 leaves visible evidence rather than a silent gap.
 *   3. EXECUTE  — call the gateway.
 *   4. SETTLE   — mark succeeded, or RELEASE the reservation on failure so the
 *                 balance is refundable again.
 *
 * The window between 1 and 4 can only ever over-report what has been refunded,
 * never under-report it. That is the safe direction: a stuck reservation blocks
 * a duplicate refund until someone looks, whereas the opposite would let the
 * same money go out twice.
 */

// ── Provider reference resolution ─────────────────────────────────────────────

interface ProviderRef {
  provider: RefundProvider;
  providerPaymentId: string;
}

/**
 * Finds which gateway took the money, and its reference for the charge.
 *
 * Handles three generations of record:
 *   • rows with explicit `provider` / `providerPaymentId` (current)
 *   • Paymob rows that encoded the transaction as `paymob_<id>` in the Stripe
 *     field, because the Payment model used to be Stripe-shaped
 *   • cash-on-delivery orders, which never touched a gateway — refunding those
 *     is a bookkeeping record, so the provider is `manual`
 */
async function resolveProviderRef(order: {
  _id: Types.ObjectId;
  paymentMethod: string;
  paymentIntentId?: string;
}): Promise<ProviderRef> {
  if (order.paymentMethod === 'cod') {
    return { provider: 'manual', providerPaymentId: '' };
  }

  const payment = await Payment.findOne({ orderId: order._id, status: 'succeeded' })
    .sort({ createdAt: -1 })
    .lean();

  if (payment) {
    if (payment.provider && payment.providerPaymentId) {
      return { provider: payment.provider, providerPaymentId: payment.providerPaymentId };
    }
    // Legacy row: the provider is encoded in the reference's prefix.
    const legacy = payment.stripePaymentIntentId ?? '';
    if (legacy.startsWith('paymob_')) {
      return { provider: 'paymob', providerPaymentId: legacy.slice('paymob_'.length) };
    }
    if (legacy) return { provider: 'stripe', providerPaymentId: legacy };
  }

  // No Payment row — fall back to the intent stamped on the order at checkout.
  if (order.paymentIntentId) {
    return { provider: 'stripe', providerPaymentId: order.paymentIntentId };
  }

  // Nothing to refund against. Recorded as manual so the merchant can still
  // reconcile a refund they made by other means.
  return { provider: 'manual', providerPaymentId: '' };
}

// ── Already-refunded quantities ───────────────────────────────────────────────

/**
 * Units already returned per product, so a line cannot be refunded twice.
 *
 * Counts only refunds that succeeded or are still in flight — a failed refund
 * released its reservation and must not block a retry.
 */
async function refundedQuantities(
  storeId: Types.ObjectId,
  orderId: Types.ObjectId
): Promise<Record<string, number>> {
  const prior = await Refund.find({
    storeId,
    orderId,
    status: { $in: ['succeeded', 'pending'] },
  }).lean();

  const tally: Record<string, number> = {};
  for (const refund of prior) {
    for (const line of refund.lines) {
      const key = line.productId.toString();
      tally[key] = (tally[key] ?? 0) + line.quantity;
    }
  }
  return tally;
}

// ── Preview ───────────────────────────────────────────────────────────────────

export interface RefundRequest {
  /** Omit (or send empty) with `refundAll` to return everything outstanding. */
  lines?: RefundRequestLine[];
  refundAll?: boolean;
  refundShipping?: boolean;
  restock?: boolean;
  reason?: string;
  note?: string;
  idempotencyKey?: string;
}

async function loadRefundableOrder(storeId: string, orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }

  const order = await Order.findOne({
    _id: new Types.ObjectId(orderId),
    storeId: new Types.ObjectId(storeId),
  }).lean();

  if (!order) throw createError('Order not found', 404, 'NOT_FOUND');
  return order;
}

/**
 * Computes what a refund would return, without moving any money.
 *
 * Exists so the merchant UI never does money arithmetic: it renders exactly the
 * figures the server would charge, from the same engine that will charge them.
 */
export async function previewRefund(
  storeId: string,
  orderId: string,
  request: RefundRequest
): Promise<RefundBreakdown & { remainingRefundable: number; currency: string }> {
  const order = await loadRefundableOrder(storeId, orderId);
  const already = await refundedQuantities(order.storeId, order._id);

  const lines = request.refundAll
    ? buildFullRefundLines(order as unknown as RefundableOrder, already)
    : request.lines ?? [];

  try {
    const breakdown = calculateRefund({
      order: order as unknown as RefundableOrder,
      lines,
      refundShipping: request.refundShipping,
      alreadyRefundedQuantities: already,
    });

    return {
      ...breakdown,
      remainingRefundable:
        Math.round((order.totalAmount - (order.refundedTotal ?? 0)) * 100) / 100,
      currency: order.currency ?? 'USD',
    };
  } catch (err) {
    if (err instanceof RefundValidationError) {
      throw createError(err.message, 400, 'REFUND_INVALID');
    }
    throw err;
  }
}

// ── Issue ─────────────────────────────────────────────────────────────────────

export async function createRefund(
  storeId: string,
  orderId: string,
  request: RefundRequest,
  issuedBy: Types.ObjectId
): Promise<IRefund> {
  const storeObjId = new Types.ObjectId(storeId);

  // ── Idempotency ────────────────────────────────────────────────────────────
  // Checked before anything else so a retried request returns the original
  // refund rather than issuing a second one.
  if (request.idempotencyKey) {
    const existing = await Refund.findOne({
      storeId: storeObjId,
      idempotencyKey: request.idempotencyKey,
    });
    if (existing) return existing;
  }

  const order = await loadRefundableOrder(storeId, orderId);

  if (order.paymentStatus === 'unpaid') {
    throw createError(
      'This order has not been paid, so there is nothing to refund. Cancel it instead.',
      400,
      'REFUND_INVALID'
    );
  }
  if (order.paymentStatus === 'refunded') {
    throw createError('This order has already been fully refunded', 400, 'REFUND_INVALID');
  }

  const already = await refundedQuantities(storeObjId, order._id);
  const lines = request.refundAll
    ? buildFullRefundLines(order as unknown as RefundableOrder, already)
    : request.lines ?? [];

  let breakdown: RefundBreakdown;
  try {
    breakdown = calculateRefund({
      order: order as unknown as RefundableOrder,
      lines,
      refundShipping: request.refundShipping,
      alreadyRefundedQuantities: already,
    });
  } catch (err) {
    if (err instanceof RefundValidationError) {
      throw createError(err.message, 400, 'REFUND_INVALID');
    }
    throw err;
  }

  const currency = (order.currency ?? 'USD').toUpperCase();
  const { provider, providerPaymentId } = await resolveProviderRef(order);

  // ── 1. RESERVE ─────────────────────────────────────────────────────────────
  // Conditional on the result staying within the order total, so two admins
  // refunding concurrently cannot together exceed it — the loser's update
  // simply matches no document.
  const reserved = await Order.findOneAndUpdate(
    {
      _id: order._id,
      storeId: storeObjId,
      $expr: {
        $lte: [
          { $add: [{ $ifNull: ['$refundedTotal', 0] }, breakdown.totalRefunded] },
          '$totalAmount',
        ],
      },
    },
    [
      {
        $set: {
          refundedTotal: {
            $round: [{ $add: [{ $ifNull: ['$refundedTotal', 0] }, breakdown.totalRefunded] }, 2],
          },
          // The tax portion, tracked alongside the gross so revenue reporting
          // can net the refund on the same basis it nets the sale. Without it a
          // fully-refunded order reports negative revenue.
          refundedTaxTotal: {
            $round: [
              { $add: [{ $ifNull: ['$refundedTaxTotal', 0] }, breakdown.taxRefunded] },
              2,
            ],
          },
        },
      },
      {
        // Derived in the same pipeline so the status can never disagree with
        // the total it was derived from.
        $set: {
          paymentStatus: {
            $cond: [
              { $gte: ['$refundedTotal', { $subtract: ['$totalAmount', 0.005] }] },
              'refunded',
              'partially_refunded',
            ],
          },
        },
      },
    ],
    { new: true }
  );

  if (!reserved) {
    throw createError(
      'That refund would exceed the amount remaining on this order. ' +
      'It may have been refunded by someone else — reload and try again.',
      409,
      'REFUND_CONFLICT'
    );
  }

  /** Undoes the reservation so the balance becomes refundable again. */
  const release = async () => {
    const releasedTotal = Math.round(
      (reserved.refundedTotal - breakdown.totalRefunded) * 100
    ) / 100;
    // Both halves of the reservation must be released, or the tax ledger drifts
    // upward on every failed attempt and revenue creeps up with it.
    const releasedTax = Math.round(
      ((reserved.refundedTaxTotal ?? 0) - breakdown.taxRefunded) * 100
    ) / 100;

    await Order.updateOne(
      { _id: order._id, storeId: storeObjId },
      {
        $set: {
          refundedTotal: Math.max(0, releasedTotal),
          refundedTaxTotal: Math.max(0, releasedTax),
          paymentStatus: derivePaymentStatus(order.totalAmount, Math.max(0, releasedTotal)),
        },
      }
    );
  };

  // ── 2. RECORD ──────────────────────────────────────────────────────────────
  const restock = request.restock ?? true;
  let refund: IRefund;
  try {
    refund = await Refund.create({
      storeId: storeObjId,
      orderId: order._id,
      customerId: order.customerId,
      lines: breakdown.lines.map((l) => ({
        productId: new Types.ObjectId(l.productId),
        name: l.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotalRefunded: l.subtotalRefunded,
        taxRefunded: l.taxRefunded,
        restocked: false,
      })),
      subtotalRefunded: breakdown.subtotalRefunded,
      taxRefunded: breakdown.taxRefunded,
      shippingRefunded: breakdown.shippingRefunded,
      totalRefunded: breakdown.totalRefunded,
      currency,
      reason: request.reason,
      note: request.note,
      status: 'pending',
      provider,
      issuedBy,
      outOfBand: false,
      ...(request.idempotencyKey && { idempotencyKey: request.idempotencyKey }),
    });
  } catch (err) {
    await release();
    // A duplicate key here means a concurrent request with the same
    // idempotency key won the race — return theirs rather than erroring.
    if ((err as { code?: number }).code === 11000 && request.idempotencyKey) {
      const winner = await Refund.findOne({
        storeId: storeObjId,
        idempotencyKey: request.idempotencyKey,
      });
      if (winner) return winner;
    }
    throw err;
  }

  // ── 3. EXECUTE ─────────────────────────────────────────────────────────────
  if (provider === 'manual') {
    // Cash on delivery, or a charge with no recoverable gateway reference. No
    // API call is possible; this records that the merchant returned the money
    // by other means so the ledger stays truthful.
    refund.status = 'succeeded';
    await refund.save();
  } else {
    try {
      // `provider` is narrowed to a gateway key here — 'manual' took the branch
      // above, so this cast cannot smuggle it into the factory.
      const gateway = paymentProviderFactory.get(provider as 'stripe' | 'paymob');
      const result = await gateway.refundPayment({
        providerPaymentId,
        // Smallest currency unit, scaled by THIS order's currency so the refund
        // is quoted on the same scale as the original charge. A hardcoded 100
        // here refunded 100× on JPY and a tenth of the amount on KWD.
        amountInSmallestUnit: toMinorUnits(breakdown.totalRefunded, currency),
        currency: currency.toLowerCase(),
        // Deterministic per refund, so a retry at the gateway is safe even if
        // our own request is replayed.
        idempotencyKey: `refund_${refund._id.toString()}`,
        reason: request.reason,
      });

      refund.providerRefundId = result.providerRefundId;
      // `pending` is not failure — the money is moving and the provider
      // confirms by webhook.
      refund.status = result.status === 'succeeded' ? 'succeeded' : 'pending';
      await refund.save();
    } catch (err) {
      // ── 4a. RELEASE ────────────────────────────────────────────────────────
      const message = (err as Error).message;
      refund.status = 'failed';
      refund.failureReason = message;
      await refund.save();
      await release();

      logger.error('Refund failed at the provider — reservation released', {
        refundId: refund._id.toString(),
        orderId: order._id.toString(),
        provider,
        error: message,
      });

      if (err instanceof RefundNotSupportedError) {
        throw createError(message, 501, 'REFUND_NOT_SUPPORTED');
      }
      throw createError(`Refund failed: ${message}`, 502, 'REFUND_FAILED');
    }
  }

  // ── 4b. SETTLE ─────────────────────────────────────────────────────────────
  // Restocking happens only after the money is confirmed on its way. Doing it
  // earlier would put goods back on sale for a refund that then failed.
  if (restock && breakdown.lines.length > 0) {
    for (const line of breakdown.lines) {
      await productRepo.restoreStock(
        new Types.ObjectId(line.productId),
        storeObjId,
        line.quantity
      );
    }
    await Refund.updateOne({ _id: refund._id }, { $set: { 'lines.$[].restocked': true } });
  }

  logger.info('Refund issued', {
    refundId: refund._id.toString(),
    orderId: order._id.toString(),
    provider,
    amount: breakdown.totalRefunded,
    currency,
    status: refund.status,
  });

  // Fire-and-forget, matching every other transactional email in the codebase:
  // a mail failure must never roll back money that has already moved.
  const { User } = await import('../auth/user.model');
  const customer = await User.findById(order.customerId).lean();
  if (customer?.email) {
    emailService.sendEmail({
      to: customer.email,
      subject: `Refund issued for order ${order._id.toString().slice(-8).toUpperCase()}`,
      html:
        `<p>We've refunded ${currency} ${breakdown.totalRefunded.toFixed(2)} ` +
        `for your order.</p><p>It may take a few business days to appear on your statement.</p>`,
      text:
        `We've refunded ${currency} ${breakdown.totalRefunded.toFixed(2)} for your order. ` +
        `It may take a few business days to appear on your statement.`,
    });
  }

  return refund;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listOrderRefunds(storeId: string, orderId: string) {
  if (!Types.ObjectId.isValid(orderId)) {
    throw createError('Invalid order ID', 400, 'BAD_REQUEST');
  }
  return Refund.find({
    storeId: new Types.ObjectId(storeId),
    orderId: new Types.ObjectId(orderId),
  })
    .sort({ createdAt: -1 })
    .lean();
}
