/**
 * Regression tests for the production payment bypass.
 *
 * CheckoutPage derived a single flag from key presence alone:
 *     const TEST_MODE = !isRealStripeKey;
 * so a PRODUCTION build with a missing/invalid VITE_STRIPE_PUBLISHABLE_KEY
 * rendered a "Skip Payment (Test)" button to real customers, marking the order
 * complete with no payment taken.
 *
 * The invariant these tests pin: 'simulated' is reachable ONLY in a dev build.
 */

import { describe, it, expect } from 'vitest';
import { isValidStripeKey, resolveCheckoutMode } from './checkoutMode';

const VALID_KEY = 'pk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

describe('isValidStripeKey', () => {
  it('accepts a well-formed publishable key', () => {
    expect(isValidStripeKey(VALID_KEY)).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['wrong prefix', 'sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'],
    ['too short', 'pk_test_123'],
    ['all-zeros placeholder', 'pk_test_000000000000000000000000000000'],
  ])('rejects %s', (_label, key) => {
    expect(isValidStripeKey(key as string | undefined)).toBe(false);
  });
});

describe('resolveCheckoutMode', () => {
  it('is live when a valid key is present, in dev', () => {
    expect(resolveCheckoutMode(VALID_KEY, true)).toBe('live');
  });

  it('is live when a valid key is present, in production', () => {
    expect(resolveCheckoutMode(VALID_KEY, false)).toBe('live');
  });

  it('allows simulation in a dev build with no key', () => {
    expect(resolveCheckoutMode(undefined, true)).toBe('simulated');
  });

  // ── The bug ──────────────────────────────────────────────────────────────
  it('NEVER allows simulation in a production build with no key', () => {
    expect(resolveCheckoutMode(undefined, false)).toBe('unavailable');
  });

  it('NEVER allows simulation in a production build with an invalid key', () => {
    expect(resolveCheckoutMode('pk_test_000000000000', false)).toBe('unavailable');
  });

  it('NEVER allows simulation in a production build with a secret key by mistake', () => {
    expect(resolveCheckoutMode('sk_live_51AbCdEfGhIjKlMnOpQrStUvWxYz012345', false)).toBe('unavailable');
  });

  it('never returns "simulated" for any input when isDev is false', () => {
    const candidates = [undefined, null, '', 'x', 'pk_', 'pk_test_000000000000', VALID_KEY];
    for (const key of candidates) {
      expect(resolveCheckoutMode(key, false)).not.toBe('simulated');
    }
  });
});
