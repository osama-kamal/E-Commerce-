/**
 * Unit tests for the refund engine.
 *
 * Pure function, no database — this is the specification for how much of a
 * customer's money goes back.
 *
 * The highest-risk property is proration. Refunding a line at list price
 * returns more than was collected whenever a coupon was applied, so refunding
 * every line individually would leave the merchant out of pocket by the whole
 * discount. The "sums back to the order total" cases below are the ones that
 * catch that.
 */

import {
  calculateRefund,
  buildFullRefundLines,
  RefundValidationError,
  RefundableOrder,
} from '../../src/modules/refunds/refund-math';

/** £100 of goods, no discount, no shipping, no tax. */
function plainOrder(overrides: Partial<RefundableOrder> = {}): RefundableOrder {
  return {
    subtotal: 100,
    discountAmount: 0,
    shippingTotal: 0,
    taxTotal: 0,
    taxLines: [],
    totalAmount: 100,
    refundedTotal: 0,
    items: [{ productId: 'p1', name: 'Widget', price: 50, quantity: 2 }],
    ...overrides,
  };
}

describe('calculateRefund — basics', () => {
  it('refunds a single line at its paid value', () => {
    const r = calculateRefund({ order: plainOrder(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(r.subtotalRefunded).toBe(50);
    expect(r.totalRefunded).toBe(50);
  });

  it('refunds every line back to exactly the order total', () => {
    const order = plainOrder();
    const r = calculateRefund({ order, lines: buildFullRefundLines(order) });
    expect(r.totalRefunded).toBe(order.totalAmount);
  });

  it('rejects a product that is not on the order', () => {
    expect(() =>
      calculateRefund({ order: plainOrder(), lines: [{ productId: 'nope', quantity: 1 }] })
    ).toThrow(RefundValidationError);
  });

  it('rejects more units than were bought', () => {
    expect(() =>
      calculateRefund({ order: plainOrder(), lines: [{ productId: 'p1', quantity: 3 }] })
    ).toThrow(/only 2 of 2 remain/);
  });

  it('rejects units already refunded', () => {
    expect(() =>
      calculateRefund({
        order: plainOrder(),
        lines: [{ productId: 'p1', quantity: 2 }],
        alreadyRefundedQuantities: { p1: 1 },
      })
    ).toThrow(/only 1 of 2 remain/);
  });

  it('rejects a zero or fractional quantity', () => {
    expect(() =>
      calculateRefund({ order: plainOrder(), lines: [{ productId: 'p1', quantity: 0 }] })
    ).toThrow(RefundValidationError);
    expect(() =>
      calculateRefund({ order: plainOrder(), lines: [{ productId: 'p1', quantity: 1.5 }] })
    ).toThrow(RefundValidationError);
  });

  it('rejects an empty request', () => {
    expect(() => calculateRefund({ order: plainOrder(), lines: [] })).toThrow(
      RefundValidationError
    );
  });
});

describe('calculateRefund — discount proration', () => {
  // £100 of goods with a £20 coupon: the customer paid £80, so each £50 line
  // was effectively sold for £40.
  const discounted = (): RefundableOrder =>
    plainOrder({ discountAmount: 20, totalAmount: 80 });

  it('refunds a line at its discounted value, not list price', () => {
    const r = calculateRefund({ order: discounted(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(r.subtotalRefunded).toBe(40); // 80 × (50/100)
    expect(r.totalRefunded).toBe(40);
  });

  it('never returns more than was collected when every line is refunded', () => {
    // The failure this guards: refunding at list price would return £100 on an
    // order that took £80, so the merchant loses the discount twice.
    const order = discounted();
    const r = calculateRefund({ order, lines: buildFullRefundLines(order) });
    expect(r.totalRefunded).toBe(80);
    expect(r.totalRefunded).toBe(order.totalAmount);
  });

  it('sums two sequential partial refunds back to the order total', () => {
    const order = discounted();
    const first = calculateRefund({ order, lines: [{ productId: 'p1', quantity: 1 }] });

    const second = calculateRefund({
      order: { ...order, refundedTotal: first.totalRefunded },
      lines: [{ productId: 'p1', quantity: 1 }],
      alreadyRefundedQuantities: { p1: 1 },
    });

    expect(first.totalRefunded + second.totalRefunded).toBe(80);
  });
});

describe('calculateRefund — tax', () => {
  // £100 goods + £20 exclusive VAT = £120 charged.
  const exclusiveVat = (): RefundableOrder =>
    plainOrder({
      taxTotal: 20,
      taxLines: [{ name: 'VAT', rate: 20, amount: 20, inclusive: false, appliesToShipping: false }],
      totalAmount: 120,
    });

  it('refunds tax proportionally on an exclusive order', () => {
    const r = calculateRefund({ order: exclusiveVat(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(r.subtotalRefunded).toBe(50);
    expect(r.taxRefunded).toBe(10);
    expect(r.totalRefunded).toBe(60);
  });

  it('returns exactly the charged amount when everything is refunded', () => {
    const order = exclusiveVat();
    const r = calculateRefund({ order, lines: buildFullRefundLines(order) });
    expect(r.totalRefunded).toBe(120);
  });

  it('does NOT add inclusive tax on top', () => {
    // £120 charged with the VAT already inside. Refunding it all must return
    // £120, not £140 — the mirror of the checkout engine's rule.
    const order = plainOrder({
      subtotal: 120,
      taxTotal: 20,
      taxLines: [{ name: 'VAT', rate: 20, amount: 20, inclusive: true, appliesToShipping: false }],
      totalAmount: 120,
      items: [{ productId: 'p1', name: 'Widget', price: 60, quantity: 2 }],
    });

    const r = calculateRefund({ order, lines: buildFullRefundLines(order) });
    expect(r.totalRefunded).toBe(120);
    expect(r.taxRefunded).toBe(20); // reported, not added
    expect(r.taxInclusive).toBe(true);
  });
});

describe('calculateRefund — shipping', () => {
  // £100 goods + £10 shipping + 20% VAT on both = £132.
  const withShipping = (): RefundableOrder =>
    plainOrder({
      shippingTotal: 10,
      taxTotal: 22,
      taxLines: [{ name: 'VAT', rate: 20, amount: 22, inclusive: false, appliesToShipping: true }],
      totalAmount: 132,
    });

  it('excludes shipping by default', () => {
    // The merchant paid the carrier whether or not the goods came back.
    const r = calculateRefund({ order: withShipping(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(r.shippingRefunded).toBe(0);
    expect(r.taxRefunded).toBe(10); // goods tax only — 20 × (50/100)
    expect(r.totalRefunded).toBe(60);
  });

  it('includes shipping and its tax when asked', () => {
    const order = withShipping();
    const r = calculateRefund({
      order,
      lines: buildFullRefundLines(order),
      refundShipping: true,
    });
    expect(r.shippingRefunded).toBe(10);
    expect(r.totalRefunded).toBe(132); // the full charged amount
  });

  it('does not refund shipping tax when only goods are returned', () => {
    // Refunding items must not hand back the tax on a delivery that happened.
    const order = withShipping();
    const r = calculateRefund({ order, lines: buildFullRefundLines(order) });
    expect(r.taxRefunded).toBe(20); // the £2 of VAT on shipping stays
    expect(r.totalRefunded).toBe(120);
  });

  it('allows a shipping-only refund with no line items', () => {
    const r = calculateRefund({ order: withShipping(), lines: [], refundShipping: true });
    expect(r.shippingRefunded).toBe(10);
    expect(r.subtotalRefunded).toBe(0);
  });
});

describe('calculateRefund — ceilings', () => {
  it('rejects a refund exceeding what remains on the order', () => {
    const order = plainOrder({ refundedTotal: 80 });
    expect(() =>
      calculateRefund({ order, lines: [{ productId: 'p1', quantity: 2 }] })
    ).toThrow(/exceeds the 20.00 still refundable/);
  });

  it('allows a refund exactly equal to what remains', () => {
    const order = plainOrder({ refundedTotal: 50 });
    const r = calculateRefund({
      order,
      lines: [{ productId: 'p1', quantity: 1 }],
      alreadyRefundedQuantities: { p1: 1 },
    });
    expect(r.totalRefunded).toBe(50);
  });

  it('rejects a refund that would compute to zero', () => {
    const free = plainOrder({ subtotal: 0, totalAmount: 0, items: [
      { productId: 'p1', name: 'Freebie', price: 0, quantity: 1 },
    ] });
    expect(() =>
      calculateRefund({ order: free, lines: [{ productId: 'p1', quantity: 1 }] })
    ).toThrow(/zero/);
  });
});

describe('buildFullRefundLines', () => {
  it('lists every unrefunded unit', () => {
    expect(buildFullRefundLines(plainOrder())).toEqual([{ productId: 'p1', quantity: 2 }]);
  });

  it('subtracts units already refunded', () => {
    expect(buildFullRefundLines(plainOrder(), { p1: 1 })).toEqual([
      { productId: 'p1', quantity: 1 },
    ]);
  });

  it('omits fully-refunded lines', () => {
    expect(buildFullRefundLines(plainOrder(), { p1: 2 })).toEqual([]);
  });
});
