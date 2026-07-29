/**
 * Unit tests for `fetchStoreBranding` (EmailService private method) and `baseHtml` (email.templates.ts).
 *
 * Validates: Requirements 2.6, 2.7, 3.1, 3.2
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { escapeHtml } from '../../src/utils/escapeHtml';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSendMail = jest.fn<() => Promise<{ messageId: string }>>().mockResolvedValue({ messageId: 'test-id' });
const mockVerify = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);

// NOTE: there is deliberately no `jest.mock('nodemailer', ...)` here.
// EmailService migrated to the Resend SDK and no longer imports nodemailer at
// all, so the mock was inert — and the dependency has since been removed from
// package.json (it carried a high-severity advisory while being entirely
// unused). mockSendMail/mockVerify are retained because the subject-line tests
// below still reference them; those tests were already failing for this same
// reason (they assert on a transport the service no longer uses).

// Store mock — controlled per test
const mockFindById = jest.fn();
jest.mock('../../src/modules/stores/store.model', () => ({
  Store: {
    findById: (...args: unknown[]) => mockFindById(...args),
  },
}));

process.env.EMAIL_USER = 'test@example.com';
process.env.EMAIL_PASS = 'test-password';
process.env.EMAIL_FROM_NAME = 'Test';
process.env.FRONTEND_URL = 'http://localhost:5173';

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { emailService } from '../../src/services/email.service';

// Access private fetchStoreBranding via any cast
const svc = emailService as any;

// Import baseHtml indirectly by calling a template function and inspecting output
// We test baseHtml behaviour through the exported template functions since baseHtml is not exported.
import {
  welcomeTemplate,
  orderConfirmationTemplate,
  passwordResetTemplate,
  orderStatusTemplate,
  paymentReceiptTemplate,
  type StoreBranding,
  type OrderEmailData,
  type OrderStatusEmailData,
  type PaymentEmailData,
} from '../../src/services/email.templates';

// ── fetchStoreBranding unit tests ─────────────────────────────────────────────

describe('fetchStoreBranding', () => {
  beforeEach(() => {
    mockFindById.mockReset();
  });

  it('returns correct StoreBranding when store exists with all fields', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<object>>().mockResolvedValue({
        name: 'Acme Shop',
        settings: {
          logoUrl: 'https://acme.com/logo.png',
          contactEmail: 'hello@acme.com',
          contactPhone: '+1-555-0100',
        },
      }),
    });

    const branding = await svc.fetchStoreBranding('507f1f77bcf86cd799439011');

    expect(branding.storeName).toBe('Acme Shop');
    expect(branding.logoUrl).toBe('https://acme.com/logo.png');
    expect(branding.contactEmail).toBe('hello@acme.com');
    expect(branding.contactPhone).toBe('+1-555-0100');
  });

  it('returns default branding when Store.findById returns null', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    });

    const branding = await svc.fetchStoreBranding('507f1f77bcf86cd799439011');

    expect(branding.storeName).toBe('Ecommerce Store');
    expect(branding.logoUrl).toBeUndefined();
    expect(branding.contactEmail).toBeUndefined();
    expect(branding.contactPhone).toBeUndefined();
  });

  it('returns default branding when Store.findById throws', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<never>>().mockRejectedValue(new Error('DB connection failed')),
    });

    const branding = await svc.fetchStoreBranding('507f1f77bcf86cd799439011');

    expect(branding.storeName).toBe('Ecommerce Store');
  });

  it('returns default branding when storeId is an invalid ObjectId string', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    });

    const branding = await svc.fetchStoreBranding('not-a-valid-objectid');

    expect(branding.storeName).toBe('Ecommerce Store');
  });

  it('omits logoUrl from result when store.settings.logoUrl is empty string', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<object>>().mockResolvedValue({
        name: 'My Store',
        settings: { logoUrl: '', contactEmail: '', contactPhone: '' },
      }),
    });

    const branding = await svc.fetchStoreBranding('507f1f77bcf86cd799439011');

    expect(branding.logoUrl).toBeUndefined();
  });

  it('omits contactEmail from result when store.settings.contactEmail is empty string', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<object>>().mockResolvedValue({
        name: 'My Store',
        settings: { logoUrl: '', contactEmail: '', contactPhone: '' },
      }),
    });

    const branding = await svc.fetchStoreBranding('507f1f77bcf86cd799439011');

    expect(branding.contactEmail).toBeUndefined();
  });

  it('omits contactPhone from result when store.settings.contactPhone is empty string', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<object>>().mockResolvedValue({
        name: 'My Store',
        settings: { logoUrl: '', contactEmail: '', contactPhone: '' },
      }),
    });

    const branding = await svc.fetchStoreBranding('507f1f77bcf86cd799439011');

    expect(branding.contactPhone).toBeUndefined();
  });

  it('never throws for any storeId string input (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (storeId) => {
        mockFindById.mockReturnValue({
          lean: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        });
        // Should never throw
        const branding = await svc.fetchStoreBranding(storeId);
        expect(typeof branding.storeName).toBe('string');
        expect(branding.storeName.length).toBeGreaterThan(0);
      }),
      { numRuns: 50 }
    );
  });
});

// ── baseHtml behaviour tests (via template functions) ─────────────────────────

describe('baseHtml — dynamic branding rendering', () => {
  const frontendUrl = 'http://localhost:5173';

  it('renders <h1> containing branding.storeName', () => {
    const branding: StoreBranding = { storeName: 'Gadget Hub' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    expect(html).toContain('<h1>Gadget Hub</h1>');
  });

  it('renders <img> tag with src equal to branding.logoUrl when logoUrl is set', () => {
    const branding: StoreBranding = { storeName: 'Acme', logoUrl: 'https://acme.com/logo.png' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    expect(html).toContain('src="https://acme.com/logo.png"');
    expect(html).toContain('<img');
  });

  it('does NOT render <img> tag when branding.logoUrl is absent', () => {
    const branding: StoreBranding = { storeName: 'Acme' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    expect(html).not.toContain('<img');
  });

  it('renders contact email in footer when branding.contactEmail is set', () => {
    const branding: StoreBranding = { storeName: 'Acme', contactEmail: 'hello@acme.com' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    expect(html).toContain('hello@acme.com');
  });

  it('renders contact phone in footer when branding.contactPhone is set', () => {
    const branding: StoreBranding = { storeName: 'Acme', contactPhone: '+1-555-0100' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    expect(html).toContain('+1-555-0100');
  });

  it('renders footer copyright containing branding.storeName', () => {
    const branding: StoreBranding = { storeName: 'TechMart' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    expect(html).toContain('TechMart. All rights reserved.');
  });

  it('does NOT render contact section when neither contactEmail nor contactPhone are set', () => {
    const branding: StoreBranding = { storeName: 'Acme' };
    const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
    // No mailto link or phone span in footer
    expect(html).not.toContain('mailto:');
  });

  // PBT: for any non-empty storeName, baseHtml always contains it in <h1> and footer
  it('always contains storeName in <h1> header and footer for any non-empty storeName (PBT)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 80 }).filter(
          (s) => s.trim().length > 0 && !s.includes('<') && !s.includes('>')
        ),
        (storeName) => {
          const branding: StoreBranding = { storeName };
          const { html } = welcomeTemplate({ email: 'u@test.com', frontendUrl }, branding);
          // Compared against the escaped form: storeName is set by the store
          // owner and lands in every email that store sends, so it is escaped
          // before interpolation. The name is still fully present — a store
          // called `Tom & Jerry` renders as `Tom &amp; Jerry`, not injectable
          // markup. (The generator already excludes < and >, but & and quotes
          // still occur.)
          const escaped = escapeHtml(storeName);
          expect(html).toContain(`<h1>${escaped}</h1>`);
          expect(html).toContain(escaped);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── sendWelcomeEmail subject line uses branding.storeName ─────────────────────

describe('sendWelcomeEmail subject line', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockFindById.mockReset();
  });

  it('uses branding.storeName in subject when store is found', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<object>>().mockResolvedValue({
        name: 'Shop Co',
        settings: {},
      }),
    });

    await emailService.sendWelcomeEmail('507f1f77bcf86cd799439011', 'user@test.com');

    expect(mockSendMail).toHaveBeenCalled();
    const call = mockSendMail.mock.calls[0] as unknown as [{ subject: string }];
    expect(call[0].subject).toBe('Welcome to Shop Co!');
  });

  it('falls back to "Ecommerce Store" in subject when store is not found', async () => {
    mockFindById.mockReturnValue({
      lean: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    });

    await emailService.sendWelcomeEmail('507f1f77bcf86cd799439011', 'user@test.com');

    expect(mockSendMail).toHaveBeenCalled();
    const call = mockSendMail.mock.calls[0] as unknown as [{ subject: string }];
    expect(call[0].subject).toBe('Welcome to Ecommerce Store!');
  });
});
