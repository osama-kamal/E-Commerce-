/**
 * Regression tests for Paymob postMessage origin validation.
 *
 * The original check was `event.origin.includes('paymob.com')`, a substring test
 * that any attacker-controlled hostname could satisfy.
 */

import { describe, it, expect } from 'vitest';
import { isTrustedPaymobOrigin } from './paymobOrigin';

describe('legitimate Paymob origins', () => {
  it.each([
    'https://accept.paymob.com',
    'https://paymob.com',
    'https://accept.paymobsolutions.com',
    'https://uae.paymob.com',
    'https://ksa.paymob.com',
    'https://pakistan.paymob.com',
  ])('accepts %s', (origin) => {
    expect(isTrustedPaymobOrigin(origin)).toBe(true);
  });
});

describe('spoofed origins the old substring check allowed', () => {
  it.each([
    ['suffix-appended domain', 'https://paymob.com.evil.io'],
    ['deep suffix append', 'https://accept.paymob.com.attacker.net'],
    ['hyphen prefix', 'https://evil-paymob.com'],
    ['paymob in a path', 'https://evil.io/paymob.com'],
    ['paymob in a subdomain of an attacker apex', 'https://paymob.com.co'],
    ['userinfo trick', 'https://accept.paymob.com@evil.io'],
  ])('rejects %s', (_label, origin) => {
    expect(isTrustedPaymobOrigin(origin)).toBe(false);
  });

  it('rejects the exact string the old check matched on', () => {
    // The old `includes('paymob.com')` returned true for this.
    expect('https://paymob.com.evil.io'.includes('paymob.com')).toBe(true);
    expect(isTrustedPaymobOrigin('https://paymob.com.evil.io')).toBe(false);
  });
});

describe('transport and malformed input', () => {
  it('rejects plaintext http', () => {
    expect(isTrustedPaymobOrigin('http://accept.paymob.com')).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['not a URL', 'accept.paymob.com'],
    ['garbage', 'javascript:alert(1)'],
    ['null origin from a sandboxed frame', 'null'],
  ])('rejects %s', (_label, origin) => {
    expect(isTrustedPaymobOrigin(origin as string | undefined)).toBe(false);
  });
});

describe('case handling', () => {
  it('is case-insensitive on the hostname', () => {
    expect(isTrustedPaymobOrigin('https://ACCEPT.PAYMOB.COM')).toBe(true);
  });
});
