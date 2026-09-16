/**
 * Regression tests for currency formatting.
 *
 * formatCurrency hardcoded USD, and the checkout rendered a literal "$" beside
 * every amount. A store pricing in EGP therefore quoted "$450.00" while Paymob
 * charged 450 EGP.
 */

import { describe, it, expect } from 'vitest';
import { formatCurrency } from './format';

describe('formatCurrency', () => {
  it('defaults to USD when no currency is given', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formats USD explicitly', () => {
    expect(formatCurrency(99.9, 'USD')).toBe('$99.90');
  });

  it('formats EGP distinguishably from USD', () => {
    const egp = formatCurrency(450, 'EGP');
    expect(egp).not.toBe('$450.00');
    expect(egp).toContain('450.00');
  });

  it('accepts a lowercase code', () => {
    expect(formatCurrency(10, 'egp')).toBe(formatCurrency(10, 'EGP'));
  });

  it('keeps the negative sign outside the symbol', () => {
    expect(formatCurrency(-1234.56)).toBe('-$1,234.56');
  });

  it('shows two fraction digits for a two-decimal currency', () => {
    expect(formatCurrency(5)).toBe('$5.00');
  });

  // Decimal places come from the currency's ISO 4217 exponent, not a constant.
  // Pinning it to 2 rendered "¥5,000.00" for a currency with no sub-unit, and
  // truncated the third decimal of the Gulf dinars.
  it('shows no fraction digits for a zero-decimal currency', () => {
    expect(formatCurrency(5000, 'JPY')).toBe('¥5,000');
    expect(formatCurrency(12500, 'KRW')).toContain('12,500');
    expect(formatCurrency(12500, 'KRW')).not.toContain('.00');
  });

  it('shows three fraction digits for a three-decimal currency', () => {
    const kwd = formatCurrency(5, 'KWD');
    expect(kwd).toContain('5.000');
  });

  it('still agrees with the server on a two-decimal currency', () => {
    expect(formatCurrency(19.99, 'USD')).toBe('$19.99');
    expect(formatCurrency(250, 'EGP')).toContain('250.00');
  });

  it('falls back gracefully on an invalid code instead of throwing', () => {
    expect(() => formatCurrency(10, 'DOLLARS')).not.toThrow();
    expect(formatCurrency(10, 'DOLLARS')).toContain('10.00');
  });

  it('treats an empty code as USD', () => {
    expect(formatCurrency(10, '')).toBe('$10.00');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
});
