/**
 * Refund calculation.
 *
 * Pure, like `checkout/money.ts`, and for the same reason: this decides how
 * much of a customer's money goes back, so every rule must be checkable without
 * a database.
 *
 * ── The problem it solves ─────────────────────────────────────────────────────
 * Refunding "one of three items" is not `unitPrice × quantity`. That figure was
 * never what the customer paid for that item:
 *
 *   • a coupon discounted the whole basket, so each line was effectively sold
 *     for less than its list price;
 *   • tax was assessed on the DISCOUNTED goods total, not the list total;
 *   • shipping was charged once for the order, not per line.
 *
 * Refunding list price would return more than was taken — refund every line
 * individually and the merchant is out of pocket by the entire discount. So a
 * line's refund is its PROPORTIONAL SHARE of what was actually collected.
 *
 * ── Proration ─────────────────────────────────────────────────────────────────
 * A line's share of the order is `lineGross / subtotal`, using the original
 * list values so the shares always sum to 1 regardless of refund order. Each
 * money component is then apportioned by that share.
 *
 * ── Inclusive tax ─────────────────────────────────────────────────────────────
 * Mirrors the checkout engine. With tax-inclusive pricing the tax is already
 * inside the line value, so it is REPORTED but not added again — adding it
 * would refund the customer more than they paid.
 */

import { IOrderTaxLine } from '../orders/order.model';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The order fields a refund is computed from. */
export interface RefundableOrder {
  subtotal: number;
  discountAmount: number;
  shippingTotal: number;
  taxTotal: number;
  taxLines: IOrderTaxLine[];
  totalAmount: number;
  refundedTotal: number;
  items: Array<{
    productId: { toString(): string };
    name: string;
    price: number;
    quantity: number;
  }>;
}

export interface RefundRequestLine {
  productId: string;
  quantity: number;
}

export interface RefundLineResult {
  productId: string;
  name: string;
  quantity: number;
  /** List price per unit, as sold. */
  unitPrice: number;
  /** Proportional share of the discounted goods value — what was actually paid. */
  subtotalRefunded: number;
  /** Proportional share of the tax assessed on goods. */
  taxRefunded: number;
}

export interface RefundBreakdown {
  lines: RefundLineResult[];
  /** Goods refunded, net of the order's discount. */
  subtotalRefunded: number;
  taxRefunded: number;
  shippingRefunded: number;
  /** What actually returns to the customer. */
  totalRefunded: number;
  /** True when the tax figure was contained in the price rather than added. */
  taxInclusive: boolean;
}

export interface CalculateRefundInput {
  order: RefundableOrder;
  lines: RefundRequestLine[];
  /**
   * Refund the delivery charge too.
   *
   * Off by default: the merchant paid the carrier whether or not the goods came
   * back, so returning it is a goodwill decision rather than an automatic
   * consequence of a return.
   */
  refundShipping?: boolean;
  /** Units already refunded per productId, so a line cannot be refunded twice. */
  alreadyRefundedQuantities?: Record<string, number>;
}

export class RefundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefundValidationError';
  }
}

/**
 * Splits the order's tax into the part assessed on goods and the part on
 * shipping.
 *
 * Only rates flagged `appliesToShipping` touched the delivery charge. Without
 * this split, refunding items would also refund the tax on shipping the
 * merchant still paid for.
 *
 * Orders written before `appliesToShipping` was persisted report it as
 * undefined; treated as false, which is correct for that era because those
 * orders had no shipping at all.
 */
function splitTax(order: RefundableOrder): { goodsTax: number; shippingTax: number } {
  const goodsBase = Math.max(0, round2(order.subtotal - order.discountAmount));
  const shipping = order.shippingTotal ?? 0;

  let goodsTax = 0;
  let shippingTax = 0;

  for (const line of order.taxLines ?? []) {
    if (!line.appliesToShipping || shipping <= 0) {
      // Entirely attributable to goods.
      goodsTax += line.amount;
      continue;
    }

    // The line's amount covered goods + shipping. Split it in proportion to the
    // two bases, which is how it was assessed in the first place.
    const base = goodsBase + shipping;
    if (base <= 0) continue;
    const shippingShare = shipping / base;
    const lineShipping = round2(line.amount * shippingShare);
    shippingTax += lineShipping;
    goodsTax += round2(line.amount - lineShipping);
  }

  return { goodsTax: round2(goodsTax), shippingTax: round2(shippingTax) };
}

/**
 * Computes what a refund returns.
 *
 * @throws {RefundValidationError} on a request that cannot be honoured —
 *   unknown product, more units than were bought or than remain unrefunded, or
 *   a total that would exceed what is left on the order.
 */
export function calculateRefund(input: CalculateRefundInput): RefundBreakdown {
  const { order, lines, refundShipping = false } = input;
  const already = input.alreadyRefundedQuantities ?? {};

  if (lines.length === 0 && !refundShipping) {
    throw new RefundValidationError('A refund must include at least one item or shipping');
  }

  const orderItems = new Map(order.items.map((i) => [i.productId.toString(), i]));
  const taxInclusive = (order.taxLines ?? []).some((l) => l.inclusive);
  const { goodsTax, shippingTax } = splitTax(order);

  // Guards against dividing by zero on a free order, where every share is 0.
  const subtotal = order.subtotal ?? 0;
  const goodsBase = Math.max(0, round2(subtotal - (order.discountAmount ?? 0)));

  const resultLines: RefundLineResult[] = [];
  let subtotalRefunded = 0;
  let taxRefunded = 0;

  for (const requested of lines) {
    if (requested.quantity <= 0 || !Number.isInteger(requested.quantity)) {
      throw new RefundValidationError('Refund quantity must be a positive whole number');
    }

    const item = orderItems.get(requested.productId);
    if (!item) {
      throw new RefundValidationError(
        `Product ${requested.productId} is not part of this order`
      );
    }

    const priorQty = already[requested.productId] ?? 0;
    const remaining = item.quantity - priorQty;
    if (requested.quantity > remaining) {
      throw new RefundValidationError(
        `Cannot refund ${requested.quantity} × "${item.name}" — only ${remaining} of ` +
        `${item.quantity} remain unrefunded`
      );
    }

    const lineGross = item.price * requested.quantity;
    // Share of the ORIGINAL order, so shares always sum to 1 no matter what
    // order the refunds happen in.
    const share = subtotal > 0 ? lineGross / subtotal : 0;

    const lineSubtotal = round2(goodsBase * share);
    const lineTax = round2(goodsTax * share);

    subtotalRefunded += lineSubtotal;
    taxRefunded += lineTax;

    resultLines.push({
      productId: requested.productId,
      name: item.name,
      quantity: requested.quantity,
      unitPrice: item.price,
      subtotalRefunded: lineSubtotal,
      taxRefunded: lineTax,
    });
  }

  subtotalRefunded = round2(subtotalRefunded);
  taxRefunded = round2(taxRefunded);

  let shippingRefunded = 0;
  if (refundShipping) {
    shippingRefunded = round2(order.shippingTotal ?? 0);
    taxRefunded = round2(taxRefunded + shippingTax);
  }

  // Inclusive tax is already inside the line values — adding it would return
  // more than the customer paid. Same rule as the checkout engine.
  const totalRefunded = round2(
    subtotalRefunded + shippingRefunded + (taxInclusive ? 0 : taxRefunded)
  );

  // Final ceiling. Per-line rounding can drift a cent, and a merchant could
  // otherwise combine "all lines" with "shipping" on an order where shipping
  // was never charged.
  const remainingRefundable = round2(order.totalAmount - (order.refundedTotal ?? 0));
  if (totalRefunded > remainingRefundable + 0.005) {
    throw new RefundValidationError(
      `Refund of ${totalRefunded.toFixed(2)} exceeds the ` +
      `${remainingRefundable.toFixed(2)} still refundable on this order`
    );
  }

  if (totalRefunded <= 0) {
    throw new RefundValidationError('Refund amount would be zero');
  }

  return {
    lines: resultLines,
    subtotalRefunded,
    taxRefunded,
    shippingRefunded,
    totalRefunded,
    taxInclusive,
  };
}

/**
 * Convenience wrapper: refund everything still outstanding on an order.
 *
 * Built from remaining quantities rather than by refunding `totalAmount`
 * directly, so a full refund produces the same auditable per-line record as a
 * partial one and restocking works identically.
 */
export function buildFullRefundLines(
  order: RefundableOrder,
  alreadyRefundedQuantities: Record<string, number> = {}
): RefundRequestLine[] {
  return order.items
    .map((item) => ({
      productId: item.productId.toString(),
      quantity: item.quantity - (alreadyRefundedQuantities[item.productId.toString()] ?? 0),
    }))
    .filter((line) => line.quantity > 0);
}
