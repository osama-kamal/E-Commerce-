/**
 * The single definition of revenue.
 *
 * ── Why this file is the whole answer ─────────────────────────────────────────
 * Revenue was computed FOUR different ways, and no two agreed:
 *
 *   1. the dashboard summed succeeded `Payment.amount / 100` — which excludes
 *      every cash-on-delivery sale, because COD never creates a Payment row;
 *   2. "top products" summed `item.price × quantity` — list prices, so a coupon
 *      never reduced it;
 *   3. analytics and the sales report summed `totalAmount − taxTotal`;
 *   4. the product-performance report summed list prices again.
 *
 * None of them subtracted refunds, so a merchant could refund an entire order
 * and watch their reported revenue not move.
 *
 * Everything that reports money now goes through this file.
 *
 * ── The definition ────────────────────────────────────────────────────────────
 *   revenue = totalAmount − tax − refunds
 *
 *   • SHIPPING is included. Delivery charged to a customer is real revenue that
 *     offsets a real carrier cost; excluding it would understate the business.
 *   • TAX is excluded. It is collected on behalf of a revenue authority and
 *     remitted — a liability, never income. Including it overstates by the rate
 *     and makes the dashboard disagree with any accounting system.
 *   • REFUNDS are subtracted. Money returned was never earned.
 *
 * A fully-refunded order therefore contributes ~0 rather than being filtered
 * out, which keeps the arithmetic self-correcting: partial and full refunds are
 * the same calculation.
 */

/**
 * Order states in which money counts as earned.
 *
 * Recognition is keyed on the PAYMENT axis, not fulfilment. That distinction
 * only became expressible when C5 split `paymentStatus` from `status`, and it
 * is what finally treats a card sale and a cash sale identically:
 *
 *   • an online order counts once the gateway confirms it;
 *   • a cash-on-delivery order counts once the merchant marks it paid — not the
 *     moment it is placed.
 *
 * Fulfilment state is deliberately NOT consulted. A paid order that was later
 * cancelled still took money, and stops counting only when it is refunded.
 */
const RECOGNISED_PAYMENT_STATES = ['paid', 'partially_refunded', 'refunded'] as const;

/**
 * Fulfilment states that stand in for payment on orders written before the
 * payment axis existed.
 */
const LEGACY_EARNED_STATES = ['processing', 'shipped', 'delivered'] as const;

/**
 * Matches orders whose money counts.
 *
 * ⚠️  The `$or` is load-bearing and the caller's filter must not contain its own
 * top-level `$or`, which would be overwritten by the spread. Use
 * `revenueMatch()` below rather than spreading this by hand.
 *
 * The second branch is what makes this change safe to deploy before
 * `migrate:payment-status` runs. An order with no `paymentStatus` falls back to
 * the fulfilment rule the old aggregations used, so historical figures are
 * IDENTICAL until the backfill lands. Without it, every pre-migration order
 * would read as unpaid and revenue would collapse to zero on deploy.
 */
export const REVENUE_RECOGNITION_CLAUSES = [
  { paymentStatus: { $in: RECOGNISED_PAYMENT_STATES } },
  { paymentStatus: { $exists: false }, status: { $in: LEGACY_EARNED_STATES } },
];

/**
 * Builds a `$match` selecting the orders whose revenue counts.
 *
 * @param base tenant and date filters. Must not contain a top-level `$or`.
 */
export function revenueMatch(base: Record<string, unknown> = {}): Record<string, unknown> {
  if ('$or' in base) {
    // Silently losing one of the two clauses would either double-count unpaid
    // orders or zero out the whole report, so refuse rather than merge badly.
    throw new Error(
      'revenueMatch(): base filter already has a top-level $or — nest it under $and instead'
    );
  }
  return { ...base, $or: REVENUE_RECOGNITION_CLAUSES };
}

/**
 * Net revenue for one order, as an aggregation expression.
 *
 * `$ifNull` throughout: `taxTotal` and `refundedTotal` are absent on orders
 * written before those features existed, and a missing field must read as zero
 * rather than poisoning the sum with null.
 */
export const NET_REVENUE_EXPR = {
  $subtract: [
    // What was earned, tax removed.
    { $subtract: ['$totalAmount', { $ifNull: ['$taxTotal', 0] }] },
    // What went back, ALSO tax removed.
    //
    // `refundedTotal` is gross — it includes the tax refunded with the goods.
    // Subtracting it from a figure that already excluded tax would remove the
    // tax twice and report NEGATIVE revenue on a fully-refunded order
    // (120 − 20 − 120 = −20). Netting the refund the same way both sides use
    // the same basis.
    {
      $subtract: [
        { $ifNull: ['$refundedTotal', 0] },
        { $ifNull: ['$refundedTaxTotal', 0] },
      ],
    },
  ],
} as const;

/**
 * Gross amount charged, before tax is removed or refunds deducted.
 * Reported alongside net revenue so a merchant can see the difference.
 */
export const GROSS_CHARGED_EXPR = { $ifNull: ['$totalAmount', 0] } as const;

export const TAX_COLLECTED_EXPR = { $ifNull: ['$taxTotal', 0] } as const;
export const REFUNDED_EXPR = { $ifNull: ['$refundedTotal', 0] } as const;

/**
 * Per-currency revenue totals.
 *
 * Orders snapshot the currency they were charged in, and nothing used to group
 * by it — so a store that ever switched currency was summing pounds into
 * dollars and reporting the result as one number. Callers surface the map and
 * headline the store's own currency.
 */
export interface RevenueByCurrency {
  currency: string;
  revenue: number;
  grossCharged: number;
  taxCollected: number;
  refunded: number;
  orderCount: number;
}

/**
 * The `$group` + `$project` tail that produces one `RevenueByCurrency` row per
 * currency. Prepend a tenant-scoped `$match` built with `revenueMatch()`.
 */
export const REVENUE_BY_CURRENCY_STAGES = [
  {
    $group: {
      _id: { $ifNull: ['$currency', 'USD'] },
      revenue: { $sum: NET_REVENUE_EXPR },
      grossCharged: { $sum: GROSS_CHARGED_EXPR },
      taxCollected: { $sum: TAX_COLLECTED_EXPR },
      refunded: { $sum: REFUNDED_EXPR },
      orderCount: { $sum: 1 },
    },
  },
  {
    $project: {
      _id: 0,
      currency: '$_id',
      revenue: { $round: ['$revenue', 2] },
      grossCharged: { $round: ['$grossCharged', 2] },
      taxCollected: { $round: ['$taxCollected', 2] },
      refunded: { $round: ['$refunded', 2] },
      orderCount: 1,
    },
  },
];

/**
 * Picks the headline figure from a per-currency breakdown.
 *
 * The store's own currency wins, so the number a merchant sees is in the money
 * they price in. Any other currency present is still returned in the map rather
 * than being folded in — folding is exactly the bug this replaces.
 */
export function headlineRevenue(
  rows: RevenueByCurrency[],
  storeCurrency: string
): number {
  const own = rows.find((r) => r.currency === storeCurrency.toUpperCase());
  if (own) return own.revenue;
  // No orders in the store's own currency. Reporting a single-currency total is
  // still honest; reporting a mixed one is not.
  return rows.length === 1 ? rows[0].revenue : 0;
}
