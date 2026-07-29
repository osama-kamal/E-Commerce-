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

  it('always shows two fraction digits', () => {
    expect(formatCurrency(5)).toBe('$5.00');
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
