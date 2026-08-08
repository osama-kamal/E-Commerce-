/**
 * Currency scale — major units ↔ gateway minor units.
 *
 * Every gateway amount in this codebase was a hardcoded `* 100`, while
 * `store.currency` accepted any three-letter code. For the ~85% of currencies
 * with two decimal places that is right by coincidence; for the rest it silently
 * charges the wrong amount:
 *
 *   JPY ¥5,000  → 500000 minor units → ¥500,000 charged   (100× over)
 *   KWD 5.000   →    500 minor units → KWD 0.500 charged   (10× under)
 *
 * The refund path made the same error in reverse, so a JPY refund returned a
 * hundredth of what was taken and the ledger never noticed.
 *
 * These are pure — no database, no gateway — so the whole matrix is checkable.
 */

import {
  minorUnitExponent,
  minorUnitFactor,
  toMinorUnits,
  fromMinorUnits,
  isSupportedCurrency,
  SUPPORTED_CURRENCIES,
} from '../../src/modules/checkout/currency';

describe('minorUnitExponent', () => {
  it('defaults to 2, which covers most currencies', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED', 'INR', 'ZAR']) {
      expect(minorUnitExponent(code)).toBe(2);
    }
  });

  it('reports 0 for currencies with no minor unit', () => {
    for (const code of ['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XOF', 'XAF', 'UGX', 'RWF']) {
      expect(minorUnitExponent(code)).toBe(0);
    }
  });

  it('reports 3 for the Gulf and North African dinars', () => {
    for (const code of ['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']) {
      expect(minorUnitExponent(code)).toBe(3);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(minorUnitExponent('jpy')).toBe(0);
    expect(minorUnitExponent('  kwd  ')).toBe(3);
  });

  it('falls back to 2 for an unknown code rather than throwing', () => {
    // Correct-by-default: a missing entry is a plausible currency, not a 100×
    // error. Configuration is refused separately, by isSupportedCurrency.
    expect(minorUnitExponent('ZZZ')).toBe(2);
  });
});

describe('minorUnitFactor', () => {
  it('matches the exponent', () => {
    expect(minorUnitFactor('JPY')).toBe(1);
    expect(minorUnitFactor('USD')).toBe(100);
    expect(minorUnitFactor('KWD')).toBe(1000);
    expect(minorUnitFactor('CLF')).toBe(10000);
  });
});

describe('toMinorUnits — the charge path', () => {
  it('scales two-decimal currencies by 100, as before', () => {
    expect(toMinorUnits(10.99, 'USD')).toBe(1099);
    expect(toMinorUnits(250, 'EGP')).toBe(25000);
  });

  it('does NOT scale a zero-decimal currency — the 100× overcharge', () => {
    expect(toMinorUnits(5000, 'JPY')).toBe(5000);
    expect(toMinorUnits(12500, 'KRW')).toBe(12500);
    // What the old hardcoded conversion would have sent:
    expect(Math.round(5000 * 100)).toBe(500000);
  });

  it('scales a three-decimal currency by 1000 — the 10× undercharge', () => {
    expect(toMinorUnits(5, 'KWD')).toBe(5000);
    expect(toMinorUnits(12.345, 'BHD')).toBe(12345);
    // What the old hardcoded conversion would have sent:
    expect(Math.round(5 * 100)).toBe(500);
  });

  it('rounds to the nearest minor unit', () => {
    expect(toMinorUnits(10.994, 'USD')).toBe(1099);
    expect(toMinorUnits(10.996, 'USD')).toBe(1100);
    expect(toMinorUnits(100.4, 'JPY')).toBe(100);
    expect(toMinorUnits(1.00005, 'KWD')).toBe(1000);
  });

  it('survives binary-float representation without dropping a unit', () => {
    // 0.1 + 0.2 === 0.30000000000000004; a bare truncation yields 30 - 1.
    expect(toMinorUnits(0.1 + 0.2, 'USD')).toBe(30);
    expect(toMinorUnits(1.005, 'USD')).toBe(101);
    expect(toMinorUnits(8.165, 'USD')).toBe(817);
  });

  it('handles zero and refuses a non-finite amount', () => {
    expect(toMinorUnits(0, 'USD')).toBe(0);
    expect(() => toMinorUnits(NaN, 'USD')).toThrow(/non-finite/);
    expect(() => toMinorUnits(Infinity, 'USD')).toThrow(/non-finite/);
  });
});

describe('fromMinorUnits — the reconciliation path', () => {
  it('is the inverse of toMinorUnits across the scales', () => {
    const cases: Array<[number, string]> = [
      [10.99, 'USD'], [250, 'EGP'], [5000, 'JPY'],
      [12500, 'KRW'], [5, 'KWD'], [12.345, 'BHD'],
    ];
    for (const [amount, code] of cases) {
      expect(fromMinorUnits(toMinorUnits(amount, code), code)).toBe(amount);
    }
  });

  it('reads a zero-decimal gateway amount at face value', () => {
    // Stripe reports ¥5,000 as 5000. Dividing by 100 read it as ¥50, which
    // under-reports the ledger and leaves money refundable that already went
    // back — the same money could then be refunded twice.
    expect(fromMinorUnits(5000, 'JPY')).toBe(5000);
    expect(5000 / 100).toBe(50);
  });

  it('reads a three-decimal gateway amount as thousandths', () => {
    expect(fromMinorUnits(5000, 'KWD')).toBe(5);
    expect(fromMinorUnits(12345, 'BHD')).toBe(12.345);
  });

  it('does not reintroduce float dust into the ledger', () => {
    expect(fromMinorUnits(1099, 'USD')).toBe(10.99);
    expect(fromMinorUnits(1, 'KWD')).toBe(0.001);
    expect(fromMinorUnits(2, 'USD')).toBe(0.02);
  });

  it('refuses a non-finite amount', () => {
    expect(() => fromMinorUnits(NaN, 'USD')).toThrow(/non-finite/);
  });
});

describe('round-trip stability', () => {
  it('holds over a sweep of amounts and scales', () => {
    const codes = ['USD', 'EGP', 'JPY', 'KRW', 'KWD', 'OMR'];
    for (const code of codes) {
      const exponent = minorUnitExponent(code);
      for (let minor = 0; minor < 2000; minor += 7) {
        const major = fromMinorUnits(minor, code);
        expect(toMinorUnits(major, code)).toBe(minor);
        // The major-unit figure never carries more precision than the currency.
        expect(Number(major.toFixed(exponent))).toBe(major);
      }
    }
  });
});

describe('isSupportedCurrency', () => {
  it('accepts the currencies the platform prices in', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'EGP', 'SAR', 'AED', 'KWD', 'JPY']) {
      expect(isSupportedCurrency(code)).toBe(true);
    }
  });

  it('rejects a code with no known scale', () => {
    // The reason the allowlist exists: an unknown code would silently take the
    // 2-decimal default and be charged at the wrong scale.
    expect(isSupportedCurrency('ZZZ')).toBe(false);
    expect(isSupportedCurrency('XYZ')).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(isSupportedCurrency('usd')).toBe(true);
    expect(isSupportedCurrency('  jpy ')).toBe(true);
  });

  it('lists every exceptional-scale currency, so none is unreachable', () => {
    // A zero- or three-decimal currency that cannot be configured would make
    // its exponent entry dead data — and the bug would come back the first time
    // someone added it to the allowlist without noticing.
    for (const code of [
      'JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XOF', 'XAF', 'UGX', 'RWF', 'BIF',
      'DJF', 'GNF', 'KMF', 'PYG', 'VUV', 'XPF', 'UYI',
      'KWD', 'BHD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD',
      'CLF', 'UYW',
    ]) {
      expect(SUPPORTED_CURRENCIES.has(code)).toBe(true);
    }
  });
});
