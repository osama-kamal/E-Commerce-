/**
 * Currency scale — major units ↔ minor units.
 *
 * Payment gateways are quoted in the smallest indivisible unit of the currency:
 * cents for USD, piastres for EGP, but *yen* for JPY (there is no sub-unit) and
 * *fils* for KWD (there are a thousand). Orders store major units, so every
 * gateway call has to convert, and the conversion factor is a property of the
 * currency — not the constant 100.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 * Every conversion in the codebase was a hardcoded `* 100` or `/ 100`, while
 * `store.currency` accepted any `/^[A-Z]{3}$/`. The result was silent and
 * severe:
 *
 *   JPY ¥5,000 order  → 500000 minor units → charged ¥500,000   (100× over)
 *   KWD 5.000 order   →    500 minor units → charged KWD 0.500   (10× under)
 *
 * Neither errors anywhere. The customer is simply billed the wrong amount, and
 * the refund path made the identical mistake in the opposite direction. This is
 * reachable in production: the platform ships a Paymob adapter for MENA, where
 * KWD, BHD, OMR, JOD and TND are all three-decimal currencies.
 *
 * ── Source ────────────────────────────────────────────────────────────────────
 * Exponents are ISO 4217. Only the exceptions are listed; the default is 2,
 * which covers the overwhelming majority of currencies. A missing entry is
 * therefore correct-by-default rather than a silent 100× error.
 */

/**
 * Currencies with NO minor unit — the smallest unit is the currency itself.
 * Passing 1000 for a ¥1,000 order is correct; passing 100000 charges 100×.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW',
  'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/**
 * Currencies whose minor unit is a THOUSANDTH — 1 KWD = 1000 fils.
 * Concentrated in the Gulf and North Africa, i.e. exactly the region the Paymob
 * adapter exists to serve.
 */
const THREE_DECIMAL_CURRENCIES = new Set([
  'BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND',
]);

/** Four-decimal outliers. Rare, but wrong by 100× if treated as 2. */
const FOUR_DECIMAL_CURRENCIES = new Set(['CLF', 'UYW']);

/**
 * Currencies a store may price in.
 *
 * An explicit allowlist rather than a format regex: an unrecognised code would
 * fall back to the 2-decimal default and be charged at a plausible-looking but
 * wrong scale, which is the failure this module exists to prevent. Refusing the
 * configuration outright is the only outcome that cannot silently move money.
 *
 * Every zero-, three- and four-decimal currency above is included, so the
 * exceptional cases are reachable and therefore testable rather than dead data.
 */
export const SUPPORTED_CURRENCIES = new Set([
  // Majors
  'USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'HKD', 'SGD',
  // Europe (non-euro)
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'ISK', 'TRY', 'UAH',
  // MENA — the Paymob region
  'EGP', 'SAR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD', 'LBP', 'MAD', 'TND',
  'DZD', 'LYD', 'IQD', 'ILS',
  // Africa
  'ZAR', 'NGN', 'KES', 'GHS', 'TZS', 'UGX', 'RWF', 'XAF', 'XOF', 'BIF', 'DJF',
  'GNF', 'KMF',
  // Asia-Pacific
  'INR', 'PKR', 'BDT', 'LKR', 'NPR', 'IDR', 'MYR', 'THB', 'PHP', 'VND', 'KRW',
  'TWD', 'VUV', 'XPF',
  // Americas
  'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'PEN', 'UYU', 'UYI', 'UYW', 'CLF', 'PYG',
]);

/** ISO 4217 exponent: how many decimal places this currency's minor unit has. */
export function minorUnitExponent(currency: string): number {
  const code = currency.trim().toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  if (FOUR_DECIMAL_CURRENCIES.has(code)) return 4;
  return 2;
}

/** The multiplier between major and minor units — 1, 100, 1000, or 10000. */
export function minorUnitFactor(currency: string): number {
  return 10 ** minorUnitExponent(currency);
}

/** Whether a store may be configured to price in this currency. */
export function isSupportedCurrency(currency: string): boolean {
  return SUPPORTED_CURRENCIES.has(currency.trim().toUpperCase());
}

/**
 * Shifts a number by `exponent` decimal places without a binary-float multiply.
 *
 * `1.005 * 100` is 100.49999999999999, so `Math.round` yields 100 and the
 * customer is short-changed a cent at exactly the boundary where rounding is
 * supposed to go up. The nearest double to 1.005 really is a hair below it, so
 * no epsilon fudge fixes this in general — `Number.EPSILON` is smaller than the
 * ULP of any value above ~4 and vanishes into the addition.
 *
 * Re-parsing the decimal representation at a shifted exponent sidesteps the
 * multiply entirely: "1.005e0" becomes "1.005e2", which parses as exactly
 * 100.5. Going through `toExponential()` first keeps this correct for values
 * already in exponential form, where naive string concatenation would produce
 * "1e-7e2" and parse as NaN.
 */
function shiftDecimal(value: number, exponent: number): number {
  const [mantissa, exp = '0'] = value.toExponential().split('e');
  return Number(`${mantissa}e${Number(exp) + exponent}`);
}

/**
 * Major units → the integer a payment gateway expects.
 *
 * Rounds half-up to the nearest minor unit. A major-unit amount carrying more
 * precision than the currency has (¥100.50, KWD 1.00005) cannot be charged as
 * written; rounding here is what every gateway does anyway, and doing it
 * explicitly keeps the figure we send equal to the figure we record.
 */
export function toMinorUnits(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) {
    throw new Error(`Cannot convert a non-finite amount to minor units: ${amount}`);
  }
  return Math.round(shiftDecimal(amount, minorUnitExponent(currency)));
}

/**
 * Gateway integer → major units, matching the scale orders are stored in.
 *
 * `Number(x.toFixed(exponent))` rather than a bare division because
 * `1 / 3 * 1000` style division reintroduces binary-float dust that then
 * compounds through the refund ledger's running totals.
 */
export function fromMinorUnits(minorAmount: number, currency: string): number {
  if (!Number.isFinite(minorAmount)) {
    throw new Error(`Cannot convert a non-finite minor amount: ${minorAmount}`);
  }
  return shiftDecimal(Math.round(minorAmount), -minorUnitExponent(currency));
}
