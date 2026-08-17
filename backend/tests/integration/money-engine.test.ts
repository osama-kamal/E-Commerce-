/**
 * Unit tests for the order money engine.
 *
 * Pure function, so no database — these are the specification for how money is
 * derived. The two tax modes are the highest-risk pair in the file: confusing
 * them overcharges every customer by the tax rate (exclusive maths on an
 * inclusive catalogue) or silently under-collects tax (the reverse).
 */

import { calculateOrderTotals } from '../../src/modules/checkout/money';

const VAT20 = { name: 'VAT', rate: 20, appliesToShipping: true };
const SALES_TAX = { name: 'Sales Tax', rate: 8.25, appliesToShipping: false };

describe('calculateOrderTotals — foundations', () => {
  it('sums line items into the subtotal', () => {
    const t = calculateOrderTotals({
      items: [
        { unitPrice: 10, quantity: 2 },
        { unitPrice: 5.5, quantity: 3 },
      ],
    });
    expect(t.subtotal).toBe(36.5);
    expect(t.grandTotal).toBe(36.5);
  });

  it('produces all-zero totals for an empty basket', () => {
    const t = calculateOrderTotals({ items: [] });
    expect(t).toMatchObject({ subtotal: 0, grandTotal: 0, taxTotal: 0, shippingTotal: 0 });
  });

  it('clamps a discount larger than the basket instead of going negative', () => {
    const t = calculateOrderTotals({ items: [{ unitPrice: 10, quantity: 1 }], discountAmount: 50 });
    expect(t.discountTotal).toBe(10);
    expect(t.grandTotal).toBe(0);
  });

  it('ignores a negative shipping amount', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 10, quantity: 1 }],
      shippingAmount: -5,
    });
    expect(t.shippingTotal).toBe(0);
    expect(t.grandTotal).toBe(10);
  });

  it('adds shipping to the grand total', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 40, quantity: 1 }],
      shippingAmount: 4.99,
    });
    expect(t.grandTotal).toBe(44.99);
  });

  it('applies the discount to goods only, never to shipping', () => {
    // A £10-off coupon must not also make delivery free — that would eat a real
    // carrier cost the merchant still has to pay.
    const t = calculateOrderTotals({
      items: [{ unitPrice: 50, quantity: 1 }],
      discountAmount: 10,
      shippingAmount: 5,
    });
    expect(t.discountTotal).toBe(10);
    expect(t.shippingTotal).toBe(5);
    expect(t.grandTotal).toBe(45);
  });
});

describe('calculateOrderTotals — tax-EXCLUSIVE (US style)', () => {
  it('adds tax on top of the listed price', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      taxRates: [SALES_TAX],
      pricesIncludeTax: false,
    });
    expect(t.subtotal).toBe(100);
    expect(t.taxTotal).toBe(8.25);
    expect(t.grandTotal).toBe(108.25);
  });

  it('taxes the DISCOUNTED goods total, not the gross', () => {
    // Taxing pre-discount would over-collect and is wrong in every jurisdiction
    // that taxes the consideration actually paid.
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      discountAmount: 20,
      taxRates: [SALES_TAX],
    });
    expect(t.taxTotal).toBe(6.6); // 80 * 8.25%
    expect(t.grandTotal).toBe(86.6);
  });

  it('excludes shipping from a rate that does not cover it', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      shippingAmount: 10,
      taxRates: [SALES_TAX],
    });
    expect(t.taxTotal).toBe(8.25); // shipping untaxed
    expect(t.grandTotal).toBe(118.25);
  });

  it('includes shipping for a rate that does cover it', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      shippingAmount: 10,
      taxRates: [VAT20],
    });
    expect(t.taxTotal).toBe(22); // (100 + 10) * 20%
    expect(t.grandTotal).toBe(132);
  });

  it('sums multiple compounding rates and reports each as its own line', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      taxRates: [
        { name: 'GST', rate: 5, appliesToShipping: false },
        { name: 'PST', rate: 7, appliesToShipping: false },
      ],
    });
    expect(t.taxTotal).toBe(12);
    expect(t.taxLines).toHaveLength(2);
    expect(t.taxLines.map(l => l.amount)).toEqual([5, 7]);
    expect(t.grandTotal).toBe(112);
  });
});

describe('calculateOrderTotals — tax-INCLUSIVE (EU/MENA style)', () => {
  it('extracts tax from the price instead of adding it', () => {
    // The customer pays exactly the listed 100 — the VAT was always inside it.
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      taxRates: [VAT20],
      pricesIncludeTax: true,
    });
    expect(t.subtotal).toBe(100);
    expect(t.grandTotal).toBe(100);
    expect(t.taxTotal).toBe(16.67); // 100 * 20/120
  });

  it('never adds inclusive tax on top of the grand total', () => {
    // The single most expensive mistake this engine could make: charging the
    // tax that was already in the price.
    const t = calculateOrderTotals({
      items: [{ unitPrice: 250, quantity: 2 }],
      taxRates: [VAT20],
      pricesIncludeTax: true,
    });
    expect(t.grandTotal).toBe(500);
  });

  it('extracts from the discounted amount', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 120, quantity: 1 }],
      discountAmount: 20,
      taxRates: [VAT20],
      pricesIncludeTax: true,
    });
    expect(t.grandTotal).toBe(100);
    expect(t.taxTotal).toBe(16.67); // 100 * 20/120
  });

  it('extracts from shipping too when the rate covers it', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      shippingAmount: 20,
      taxRates: [VAT20],
      pricesIncludeTax: true,
    });
    expect(t.grandTotal).toBe(120);
    expect(t.taxTotal).toBe(20); // 120 * 20/120
  });

  it('uses the COMBINED rate as the denominator when rates compound', () => {
    // Extracting each rate against its own denominator would under-report:
    // 100*5/105 + 100*7/107 = 11.30, when the true contained tax at a combined
    // 12% is 100*12/112 = 10.71. The shared denominator is what makes the
    // extracted lines add up to the tax actually inside the price.
    const t = calculateOrderTotals({
      items: [{ unitPrice: 112, quantity: 1 }],
      taxRates: [
        { name: 'GST', rate: 5, appliesToShipping: false },
        { name: 'PST', rate: 7, appliesToShipping: false },
      ],
      pricesIncludeTax: true,
    });
    expect(t.grandTotal).toBe(112);
    expect(t.taxTotal).toBe(12); // 112 * 12/112
    expect(t.taxLines.map(l => l.amount)).toEqual([5, 7]);
  });

  it('marks lines as inclusive so an invoice can label them correctly', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 100, quantity: 1 }],
      taxRates: [VAT20],
      pricesIncludeTax: true,
    });
    expect(t.taxLines[0]).toMatchObject({ name: 'VAT', rate: 20, inclusive: true });
  });
});

describe('calculateOrderTotals — rounding', () => {
  it('keeps every stored figure at 2dp', () => {
    const t = calculateOrderTotals({
      items: [{ unitPrice: 19.99, quantity: 3 }],
      shippingAmount: 3.33,
      taxRates: [SALES_TAX],
    });
    for (const value of [t.subtotal, t.discountTotal, t.shippingTotal, t.taxTotal, t.grandTotal]) {
      expect(Number.isInteger(Math.round(value * 100))).toBe(true);
      expect(value).toBe(Math.round(value * 100) / 100);
    }
  });

  it('makes the printed tax lines add up to the printed tax total', () => {
    // Summing raw values and rounding once leaves invoices off by a cent.
    const t = calculateOrderTotals({
      items: [{ unitPrice: 33.33, quantity: 3 }],
      taxRates: [
        { name: 'A', rate: 7.5, appliesToShipping: false },
        { name: 'B', rate: 2.25, appliesToShipping: false },
      ],
    });
    const summed = t.taxLines.reduce((s, l) => s + l.amount, 0);
    expect(Math.round(summed * 100) / 100).toBe(t.taxTotal);
  });

  it('does not lose a cent to floating point on a classic case', () => {
    const t = calculateOrderTotals({ items: [{ unitPrice: 0.1, quantity: 3 }] });
    expect(t.subtotal).toBe(0.3);
  });
});
