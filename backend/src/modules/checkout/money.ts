/**
 * Order money calculation.
 *
 * The single place where an order's totals are derived. Pure: no database, no
 * config, no clock — every input is passed in, so the whole matrix (both tax
 * modes, compounding rates, taxable shipping, rounding edges) is unit-testable
 * without provisioning a tenant.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 * `order.totalAmount` was `subtotal − discount`. There was no shipping and no
 * tax anywhere in the codebase, so a merchant could not charge for delivery and
 * no VAT/GST/sales-tax jurisdiction could legally use the platform.
 *
 * ── Field contract ────────────────────────────────────────────────────────────
 *   subtotal       Σ(unitPrice × qty). Line prices are already net of any
 *                  product-level discount percentage.
 *   discountTotal  Coupon discount, clamped to [0, subtotal].
 *   shippingTotal  Cost of the chosen shipping method.
 *   taxTotal       Tax ADDED (exclusive mode) or tax CONTAINED (inclusive).
 *   grandTotal     The amount actually charged. This is what is written to
 *                  `order.totalAmount`, so every existing payment path keeps
 *                  charging the right figure without modification.
 *
 * ── The two tax modes ─────────────────────────────────────────────────────────
 * EXCLUSIVE (US style) — listed prices are pre-tax; tax is added on top:
 *     grandTotal = subtotal − discount + shipping + tax
 *
 * INCLUSIVE (EU/UK/MENA style) — listed prices already contain tax; the invoice
 * merely breaks out the component that was always there:
 *     grandTotal = subtotal − discount + shipping        (tax NOT added)
 *     tax        = gross × rate / (100 + rate)           (extracted)
 *
 * Getting this backwards overcharges every customer by the tax rate, so the
 * mode is an explicit input rather than anything inferred.
 */

/** Round to 2 decimal places. Applied at every boundary so stored money is exact. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface MoneyLineInput {
  /** Effective unit price — already net of the product's own discount percentage. */
  unitPrice: number;
  quantity: number;
}

export interface TaxRateInput {
  name: string;
  /** Percentage, e.g. 20 for 20% or 8.25 for 8.25%. */
  rate: number;
  /**
   * Whether this rate also applies to the shipping charge. Jurisdiction-
   * dependent: most EU VAT taxes delivery, many US states do not.
   *
   * Every rate always applies to goods; this flag only extends it to shipping.
   */
  appliesToShipping: boolean;
}

export interface TaxLine {
  name: string;
  rate: number;
  amount: number;
  /** True when this amount was extracted from the price rather than added to it. */
  inclusive: boolean;
  /**
   * Whether this rate covered shipping as well as goods.
   *
   * Carried through onto the order because a refund needs it: returning items
   * must refund the tax on those items without refunding the tax on delivery,
   * and that split cannot be recovered from the combined `amount`.
   */
  appliesToShipping: boolean;
}

export interface CalculateTotalsInput {
  items: MoneyLineInput[];
  discountAmount?: number;
  shippingAmount?: number;
  taxRates?: TaxRateInput[];
  /** When true, `unitPrice` already contains tax. See the header. */
  pricesIncludeTax?: boolean;
}

export interface OrderTotals {
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  taxLines: TaxLine[];
}

/**
 * Computes an order's money breakdown.
 *
 * Ordering is deliberate and matters for correctness:
 *   1. Sum the lines.
 *   2. Apply the discount to goods only — discounting the shipping charge or
 *      the tax would let a coupon reduce a carrier cost or a state liability.
 *   3. Add shipping.
 *   4. Tax the discounted goods, plus shipping for rates that cover it.
 */
export function calculateOrderTotals(input: CalculateTotalsInput): OrderTotals {
  const pricesIncludeTax = input.pricesIncludeTax ?? false;
  const rates = (input.taxRates ?? []).filter((r) => r.rate > 0);

  // ── 1. Goods ───────────────────────────────────────────────────────────────
  const subtotal = round2(
    input.items.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  );

  // ── 2. Discount ────────────────────────────────────────────────────────────
  // Clamped so a coupon larger than the basket can never produce a negative
  // total, and never eats into shipping or tax.
  const discountTotal = round2(Math.min(Math.max(input.discountAmount ?? 0, 0), subtotal));

  // ── 3. Shipping ────────────────────────────────────────────────────────────
  const shippingTotal = round2(Math.max(input.shippingAmount ?? 0, 0));

  /** Goods base that tax is assessed on. */
  const goodsBase = round2(subtotal - discountTotal);

  // ── 4. Tax ─────────────────────────────────────────────────────────────────
  // Two possible bases, so two possible inclusive denominators:
  //   • goods    — every rate applies
  //   • shipping — only rates flagged appliesToShipping
  //
  // For inclusive extraction the denominator must be the SUM of all rates
  // sharing that base. Extracting each rate independently against its own
  // denominator would under-report whenever two rates compound (e.g. Canadian
  // GST + PST), because each would ignore the other's share of the gross.
  const goodsRateSum = rates.reduce((sum, r) => sum + r.rate, 0);
  const shippingRateSum = rates
    .filter((r) => r.appliesToShipping)
    .reduce((sum, r) => sum + r.rate, 0);

  const taxLines: TaxLine[] = rates.map((r) => {
    const shippingPortion = r.appliesToShipping ? shippingTotal : 0;

    let amount: number;
    if (pricesIncludeTax) {
      const fromGoods = goodsRateSum > 0 ? (goodsBase * r.rate) / (100 + goodsRateSum) : 0;
      const fromShipping =
        shippingRateSum > 0 ? (shippingPortion * r.rate) / (100 + shippingRateSum) : 0;
      amount = fromGoods + fromShipping;
    } else {
      amount = ((goodsBase + shippingPortion) * r.rate) / 100;
    }

    return {
      name: r.name,
      rate: r.rate,
      amount: round2(amount),
      inclusive: pricesIncludeTax,
      appliesToShipping: r.appliesToShipping,
    };
  });

  // Summed from the ROUNDED per-line amounts, so the printed lines on an
  // invoice always add up to the printed total. Summing first and rounding once
  // would leave invoices that are off by a cent.
  const taxTotal = round2(taxLines.reduce((sum, line) => sum + line.amount, 0));

  // ── 5. Grand total ─────────────────────────────────────────────────────────
  // Inclusive tax is already inside `subtotal`, so adding it here would charge
  // the customer the tax twice.
  const grandTotal = round2(
    goodsBase + shippingTotal + (pricesIncludeTax ? 0 : taxTotal)
  );

  return { subtotal, discountTotal, shippingTotal, taxTotal, grandTotal, taxLines };
}
