/**
 * Every email must carry the TENANT's branding, not the platform's.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6**
 *
 * ── History ───────────────────────────────────────────────────────────────────
 * Written as a bug-reproduction test: all five send methods ignored `storeId`
 * and rendered the platform name, so every merchant's customers received email
 * branded "Ecommerce Store". The header used to say the test MUST FAIL, and that
 * failing was the point.
 *
 * The bug was fixed — `fetchStoreBranding` resolves the store and the templates
 * render `store.name`. But this file kept failing afterwards for an unrelated
 * reason: it captured outbound mail by spying on **nodemailer's** `sendMail`,
 * and the service had migrated to the **Resend** SDK. `nodemailer` is not even a
 * dependency any more. So the spy was never called, `getCapturedHtml()` threw on
 * an empty mock, and the suite reported a branding bug that no longer existed —
 * for months, in a permanently-red CI.
 *
 * It now mocks the transport the service actually uses, so a failure here means
 * what it says again.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

// ── Mocks (must be declared before module imports) ────────────────────────────

// Capture the payload handed to Resend so the rendered HTML can be inspected.
const mockSend = jest
  .fn<() => Promise<{ data: { id: string }; error: null }>>()
  .mockResolvedValue({ data: { id: 'test-id' }, error: null });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: (...args: unknown[]) => mockSend(...(args as [])) },
  })),
}));

// EmailService reads this in its constructor and stays disabled without it —
// a disabled service returns before ever calling the transport, which would
// leave the capture empty for a second, equally invisible reason.
process.env.RESEND_API_KEY = 'test-resend-key';

// Mock Store.findById to return "Acme Shop" store data
jest.mock('../../src/modules/stores/store.model', () => ({
  Store: {
    findById: jest.fn(() => ({
      lean: jest.fn<() => Promise<object>>().mockResolvedValue({
        name: 'Acme Shop',
        settings: {
          logoUrl: 'https://acme.com/logo.png',
          contactEmail: 'hello@acme.com',
          contactPhone: '+1-555-0100',
        },
      }),
    })),
  },
}));

// ── Environment setup ─────────────────────────────────────────────────────────

// Set required env vars before importing EmailService so it initialises with enabled=true
process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'test-password';
process.env.EMAIL_FROM_NAME = 'Test Store';
process.env.FRONTEND_URL = 'http://localhost:5173';

// ── Imports (after mocks and env vars) ───────────────────────────────────────

import { emailService } from '../../src/services/email.service';
import type { OrderEmailData, OrderStatusEmailData, PaymentEmailData } from '../../src/services/email.service';

// ── Test Data ─────────────────────────────────────────────────────────────────

const STORE_ID = '507f1f77bcf86cd799439011'; // representative MongoDB ObjectId string
const USER_EMAIL = 'user@test.com';

const orderData: OrderEmailData = {
  orderId: 'ORD-TEST-001',
  items: [
    { name: 'Widget Pro', quantity: 2, price: 29.99 },
    { name: 'Gadget Plus', quantity: 1, price: 49.99 },
  ],
  totalAmount: 109.97,
  shippingAddress: {
    line1: '123 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701',
    country: 'US',
  },
  createdAt: new Date('2025-01-15T10:00:00Z'),
};

const statusData: OrderStatusEmailData = {
  orderId: 'ORD-TEST-001',
  status: 'shipped',
  updatedAt: new Date('2025-01-16T14:00:00Z'),
};

const paymentData: PaymentEmailData = {
  orderId: 'ORD-TEST-001',
  amount: 10997,
  currency: 'usd',
  paymentIntentId: 'pi_test_abc123',
  paidAt: new Date('2025-01-15T10:05:00Z'),
};

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns the HTML from the most recent send.
 * Fails loudly if nothing was sent — an empty capture must never read as a pass.
 */
function getCapturedHtml(): string {
  expect(mockSend).toHaveBeenCalled();
  const calls = mockSend.mock.calls;
  const lastCall = calls[calls.length - 1] as unknown as [{ html: string }];
  return lastCall[0].html;
}

// ── Store-branded email content ───────────────────────────────────────────────

describe('every email type renders the tenant store name, not the platform name', () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  /**
   * Test Case 1: Welcome Email
   *
   * EXPECTED (after fix): HTML contains "Acme Shop"
   * ACTUAL (unfixed code): HTML contains "Ecommerce Store"
   *
   * Counterexample: sendWelcomeEmail renders <h1>Ecommerce Store</h1> instead of <h1>Acme Shop</h1>
   */
  it('sendWelcomeEmail — HTML should contain store name "Acme Shop" not "Ecommerce Store"', async () => {
    // On unfixed code, sendWelcomeEmail(to) does not accept storeId.
    // We cast to any to allow passing storeId — this mirrors what the fixed code will look like
    // and surfaces the bug: the storeId is ignored and PLATFORM_NAME is used instead.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (emailService.sendWelcomeEmail as any)(STORE_ID, USER_EMAIL);

    const html = getCapturedHtml();

    // This assertion FAILS on unfixed code: HTML contains "Ecommerce Store" not "Acme Shop"
    expect(html).toContain('Acme Shop');
    expect(html).not.toContain('Ecommerce Store');
  });

  /**
   * Test Case 2: Password Reset Email
   *
   * EXPECTED (after fix): HTML contains "Acme Shop"
   * ACTUAL (unfixed code): HTML contains "Ecommerce Store"
   *
   * Counterexample: sendPasswordResetEmail renders footer "© 2025 Ecommerce Store" instead of "© 2025 Acme Shop"
   */
  it('sendPasswordResetEmail — HTML should contain store name "Acme Shop" not "Ecommerce Store"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (emailService.sendPasswordResetEmail as any)(STORE_ID, USER_EMAIL, 'token123');

    const html = getCapturedHtml();

    // This assertion FAILS on unfixed code
    expect(html).toContain('Acme Shop');
    expect(html).not.toContain('Ecommerce Store');
  });

  /**
   * Test Case 3: Order Confirmation Email
   *
   * EXPECTED (after fix): HTML contains "Acme Shop"
   * ACTUAL (unfixed code): HTML contains "Ecommerce Store"
   *
   * Counterexample: sendOrderConfirmationEmail renders <h1>Ecommerce Store</h1> instead of <h1>Acme Shop</h1>
   */
  it('sendOrderConfirmationEmail — HTML should contain store name "Acme Shop" not "Ecommerce Store"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (emailService.sendOrderConfirmationEmail as any)(STORE_ID, USER_EMAIL, orderData);

    const html = getCapturedHtml();

    // This assertion FAILS on unfixed code
    expect(html).toContain('Acme Shop');
    expect(html).not.toContain('Ecommerce Store');
  });

  /**
   * Test Case 4: Order Status Email
   *
   * EXPECTED (after fix): HTML contains "Acme Shop"
   * ACTUAL (unfixed code): HTML contains "Ecommerce Store"
   *
   * Counterexample: sendOrderStatusEmail renders footer "© 2025 Ecommerce Store" instead of "© 2025 Acme Shop"
   */
  it('sendOrderStatusEmail — HTML should contain store name "Acme Shop" not "Ecommerce Store"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (emailService.sendOrderStatusEmail as any)(STORE_ID, USER_EMAIL, statusData);

    const html = getCapturedHtml();

    // This assertion FAILS on unfixed code
    expect(html).toContain('Acme Shop');
    expect(html).not.toContain('Ecommerce Store');
  });

  /**
   * Test Case 5: Payment Receipt Email
   *
   * EXPECTED (after fix): HTML contains "Acme Shop"
   * ACTUAL (unfixed code): HTML contains "Ecommerce Store"
   *
   * Counterexample: sendPaymentReceiptEmail renders footer "© 2025 Ecommerce Store" instead of "© 2025 Acme Shop"
   */
  it('sendPaymentReceiptEmail — HTML should contain store name "Acme Shop" not "Ecommerce Store"', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (emailService.sendPaymentReceiptEmail as any)(STORE_ID, USER_EMAIL, paymentData);

    const html = getCapturedHtml();

    // This assertion FAILS on unfixed code
    expect(html).toContain('Acme Shop');
    expect(html).not.toContain('Ecommerce Store');
  });
});
