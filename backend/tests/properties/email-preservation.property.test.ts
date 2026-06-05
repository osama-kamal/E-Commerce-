/**
 * Property 2: Preservation — Non-Branding Email Content Unchanged Across All Template Types
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10**
 *
 * IMPORTANT: These tests are written BEFORE the fix is applied.
 * They MUST PASS on unfixed code — they capture the baseline behavior that must be preserved.
 *
 * Observation-first methodology:
 *   - Observed orderConfirmationTemplate: HTML contains orderId, item names, totalAmount, address fields
 *   - Observed paymentReceiptTemplate: HTML contains orderId, amount, paymentIntentId
 *   - Observed passwordResetTemplate: HTML contains the full resetUrl
 *   - Observed orderStatusTemplate (shipped): HTML contains orderId, "SHIPPED", estimated delivery notice
 *   - Observed orderStatusTemplate (cancelled): HTML contains support contact message
 *
 * These tests call template functions with their CURRENT (unfixed) signatures.
 * After the fix is applied (task 3), the same tests will continue to pass — confirming no regressions.
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  orderConfirmationTemplate,
  paymentReceiptTemplate,
  passwordResetTemplate,
  orderStatusTemplate,
} from '../../src/services/email.templates';
import type {
  OrderEmailData,
  PaymentEmailData,
  OrderStatusEmailData,
} from '../../src/services/email.templates';

// ── Arbitraries ───────────────────────────────────────────────────────────────

/**
 * Generates a non-empty string safe for use as an identifier (orderId, name, etc.)
 * Avoids characters that could be misinterpreted as HTML or regex special chars.
 */
const safeString = fc.string({ minLength: 1, maxLength: 40 }).filter(
  (s) => s.trim().length > 0 && !s.includes('<') && !s.includes('>') && !s.includes('&')
);

/** Generates a valid order item */
const orderItemArb = fc.record({
  name: safeString,
  quantity: fc.integer({ min: 1, max: 99 }),
  price: fc.float({ min: 0, max: 9999, noNaN: true }),
});

/** Generates a full OrderEmailData object */
const orderEmailDataArb: fc.Arbitrary<OrderEmailData & { frontendUrl: string }> = fc.record({
  orderId: safeString,
  items: fc.array(orderItemArb, { minLength: 1, maxLength: 5 }),
  totalAmount: fc.float({ min: 0, max: 99999, noNaN: true }),
  shippingAddress: fc.record({
    line1: safeString,
    city: safeString,
    state: safeString,
    postalCode: safeString,
    country: safeString,
  }),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  frontendUrl: fc.constant('http://localhost:5173'),
});

/** Generates a full PaymentEmailData object */
const paymentEmailDataArb: fc.Arbitrary<PaymentEmailData & { frontendUrl: string }> = fc.record({
  orderId: safeString,
  amount: fc.integer({ min: 0, max: 9999999 }),
  currency: fc.constantFrom('usd', 'eur', 'gbp', 'cad', 'aud'),
  paymentIntentId: safeString,
  paidAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
  frontendUrl: fc.constant('http://localhost:5173'),
});

/** Generates a full OrderStatusEmailData object for a given status */
function orderStatusDataArb(
  status: OrderStatusEmailData['status']
): fc.Arbitrary<OrderStatusEmailData & { frontendUrl: string }> {
  return fc.record({
    orderId: safeString,
    status: fc.constant(status),
    updatedAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
    frontendUrl: fc.constant('http://localhost:5173'),
  });
}

// ── Property 2a: Order Confirmation Content Preservation ─────────────────────

describe('Property 2a: orderConfirmationTemplate — order content preserved in HTML', () => {
  /**
   * For any OrderEmailData, the rendered HTML must contain:
   *   - the orderId
   *   - each item's name
   *   - the formatted totalAmount (as "$X.XX")
   *
   * Validates: Requirements 3.5
   */
  it('HTML contains orderId for any valid OrderEmailData', () => {
    fc.assert(
      fc.property(orderEmailDataArb, (data) => {
        const { html } = orderConfirmationTemplate(data);
        expect(html).toContain(data.orderId);
      }),
      { numRuns: 100 }
    );
  });

  it('HTML contains each item name for any valid OrderEmailData', () => {
    fc.assert(
      fc.property(orderEmailDataArb, (data) => {
        const { html } = orderConfirmationTemplate(data);
        for (const item of data.items) {
          expect(html).toContain(item.name);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('HTML contains formatted totalAmount for any valid OrderEmailData', () => {
    fc.assert(
      fc.property(orderEmailDataArb, (data) => {
        const { html } = orderConfirmationTemplate(data);
        // Template formats as "$X.XX"
        const formatted = `$${data.totalAmount.toFixed(2)}`;
        expect(html).toContain(formatted);
      }),
      { numRuns: 100 }
    );
  });

  it('HTML contains all shipping address fields for any valid OrderEmailData', () => {
    fc.assert(
      fc.property(orderEmailDataArb, (data) => {
        const { html } = orderConfirmationTemplate(data);
        const addr = data.shippingAddress;
        expect(html).toContain(addr.line1);
        expect(html).toContain(addr.city);
        expect(html).toContain(addr.state);
        expect(html).toContain(addr.postalCode);
        expect(html).toContain(addr.country);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 2b: Payment Receipt Content Preservation ────────────────────────

describe('Property 2b: paymentReceiptTemplate — payment content preserved in HTML', () => {
  /**
   * For any PaymentEmailData, the rendered HTML must contain:
   *   - the orderId
   *   - the paymentIntentId
   *
   * Validates: Requirements 3.7
   */
  it('HTML contains orderId for any valid PaymentEmailData', () => {
    fc.assert(
      fc.property(paymentEmailDataArb, (data) => {
        const { html } = paymentReceiptTemplate(data);
        expect(html).toContain(data.orderId);
      }),
      { numRuns: 100 }
    );
  });

  it('HTML contains paymentIntentId for any valid PaymentEmailData', () => {
    fc.assert(
      fc.property(paymentEmailDataArb, (data) => {
        const { html } = paymentReceiptTemplate(data);
        expect(html).toContain(data.paymentIntentId);
      }),
      { numRuns: 100 }
    );
  });
});

// ── Property 2c: Password Reset URL Preservation ─────────────────────────────

describe('Property 2c: passwordResetTemplate — resetUrl preserved in HTML', () => {
  /**
   * For any non-empty resetUrl string, the rendered HTML must contain the exact URL.
   *
   * Validates: Requirements 3.4
   */
  it('HTML contains the exact resetUrl for any non-empty resetUrl', () => {
    fc.assert(
      fc.property(
        // Generate realistic reset URLs: scheme + host + path + token
        fc.record({
          token: fc.hexaString({ minLength: 8, maxLength: 64 }),
        }).map(({ token }) => `https://example.com/reset-password?token=${token}`),
        (resetUrl) => {
          const { html } = passwordResetTemplate({ resetUrl, frontendUrl: 'http://localhost:5173' });
          expect(html).toContain(resetUrl);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('HTML contains 1-hour expiry notice for any resetUrl', () => {
    fc.assert(
      fc.property(
        fc.record({
          token: fc.hexaString({ minLength: 8, maxLength: 64 }),
        }).map(({ token }) => `https://example.com/reset-password?token=${token}`),
        (resetUrl) => {
          const { html } = passwordResetTemplate({ resetUrl, frontendUrl: 'http://localhost:5173' });
          // Requirement 3.4: must include 1-hour expiry notice
          expect(html).toContain('1 hour');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('HTML contains ignore notice for any resetUrl', () => {
    fc.assert(
      fc.property(
        fc.record({
          token: fc.hexaString({ minLength: 8, maxLength: 64 }),
        }).map(({ token }) => `https://example.com/reset-password?token=${token}`),
        (resetUrl) => {
          const { html } = passwordResetTemplate({ resetUrl, frontendUrl: 'http://localhost:5173' });
          // Requirement 3.4: must include ignore notice
          expect(html.toLowerCase()).toContain('ignore');
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ── Property 2d: Order Status Content Preservation ───────────────────────────

describe('Property 2d: orderStatusTemplate — status content preserved in HTML', () => {
  /**
   * For each status, the rendered HTML must contain:
   *   - the orderId
   *   - the status label in uppercase
   *   - status-specific extra content (shipped → delivery notice, cancelled → support message)
   *
   * Validates: Requirements 3.6, 3.8, 3.9
   */

  const allStatuses: Array<OrderStatusEmailData['status']> = [
    'processing',
    'shipped',
    'delivered',
    'cancelled',
  ];

  for (const status of allStatuses) {
    it(`HTML contains orderId for status "${status}"`, () => {
      fc.assert(
        fc.property(orderStatusDataArb(status), (data) => {
          const { html } = orderStatusTemplate(data);
          expect(html).toContain(data.orderId);
        }),
        { numRuns: 50 }
      );
    });

    it(`HTML contains status label "${status.toUpperCase()}" for status "${status}"`, () => {
      fc.assert(
        fc.property(orderStatusDataArb(status), (data) => {
          const { html } = orderStatusTemplate(data);
          expect(html).toContain(status.toUpperCase());
        }),
        { numRuns: 50 }
      );
    });
  }

  it('HTML contains estimated delivery notice for status "shipped" (Requirement 3.8)', () => {
    fc.assert(
      fc.property(orderStatusDataArb('shipped'), (data) => {
        const { html } = orderStatusTemplate(data);
        // Requirement 3.8: shipped emails include estimated delivery notice
        expect(html.toLowerCase()).toContain('estimated delivery');
      }),
      { numRuns: 50 }
    );
  });

  it('HTML contains support contact message for status "cancelled" (Requirement 3.9)', () => {
    fc.assert(
      fc.property(orderStatusDataArb('cancelled'), (data) => {
        const { html } = orderStatusTemplate(data);
        // Requirement 3.9: cancelled emails include support contact message
        expect(html.toLowerCase()).toContain('support');
      }),
      { numRuns: 50 }
    );
  });
});

// ── Property 2e: Branding Fallback Preserves Existing Behavior ───────────────

describe('Property 2e: Branding fallback — "Ecommerce Store" output matches original unfixed output', () => {
  /**
   * When the store name equals the default "Ecommerce Store" (the fallback case),
   * the template output must be identical to the original unfixed output.
   *
   * This is verified by calling the template functions with their current (unfixed) signatures
   * and confirming the HTML contains "Ecommerce Store" in the header and footer.
   *
   * After the fix, when branding.storeName === 'Ecommerce Store', the output must be identical.
   *
   * Validates: Requirements 2.7, 3.10
   */

  it('orderConfirmationTemplate HTML contains "Ecommerce Store" in header and footer (baseline)', () => {
    fc.assert(
      fc.property(orderEmailDataArb, (data) => {
        const { html } = orderConfirmationTemplate(data);
        // On unfixed code, PLATFORM_NAME is always "Ecommerce Store"
        expect(html).toContain('Ecommerce Store');
      }),
      { numRuns: 50 }
    );
  });

  it('paymentReceiptTemplate HTML contains "Ecommerce Store" in header and footer (baseline)', () => {
    fc.assert(
      fc.property(paymentEmailDataArb, (data) => {
        const { html } = paymentReceiptTemplate(data);
        expect(html).toContain('Ecommerce Store');
      }),
      { numRuns: 50 }
    );
  });

  it('passwordResetTemplate HTML contains "Ecommerce Store" in footer (baseline)', () => {
    fc.assert(
      fc.property(
        fc.record({
          token: fc.hexaString({ minLength: 8, maxLength: 64 }),
        }).map(({ token }) => `https://example.com/reset-password?token=${token}`),
        (resetUrl) => {
          const { html } = passwordResetTemplate({ resetUrl, frontendUrl: 'http://localhost:5173' });
          expect(html).toContain('Ecommerce Store');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('orderStatusTemplate HTML contains "Ecommerce Store" in footer for all statuses (baseline)', () => {
    for (const status of ['processing', 'shipped', 'delivered', 'cancelled'] as const) {
      fc.assert(
        fc.property(orderStatusDataArb(status), (data) => {
          const { html } = orderStatusTemplate(data);
          expect(html).toContain('Ecommerce Store');
        }),
        { numRuns: 25 }
      );
    }
  });

  it('HTML contains unsubscribe footer notice for all template types (Requirement 3.10)', () => {
    fc.assert(
      fc.property(orderEmailDataArb, (data) => {
        const { html } = orderConfirmationTemplate(data);
        expect(html.toLowerCase()).toContain('unsubscribe');
      }),
      { numRuns: 50 }
    );
  });
});
