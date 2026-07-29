import { formatDistanceToNow } from 'date-fns';

/**
 * Format a number as currency.
 *
 * The `currency` argument is not decorative: a store may price in EGP while the
 * UI used to render "$" unconditionally, so a Paymob customer was quoted dollars
 * and charged pounds. Pass the currency from the order or the active store.
 *
 * @param value    - numeric amount in major units
 * @param currency - ISO 4217 code; defaults to USD for callers not yet updated
 * @returns e.g. "$1,234.56", "EGP 1,234.56", "-$1,234.56"
 */
export function formatCurrency(value: number, currency = 'USD'): string {
  const isNegative = value < 0;
  const absoluteValue = Math.abs(value);
  const code = (currency || 'USD').toUpperCase();

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absoluteValue);
  } catch {
    // Unknown/invalid ISO code — fall back to "CODE 1,234.56" rather than
    // throwing inside a render.
    formatted = `${code} ${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(absoluteValue)}`;
  }

  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Format a timestamp as relative time
 * @param timestamp - ISO 8601 timestamp string or Date object
 * @returns Relative time string (e.g., "5 minutes ago", "2 hours ago")
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  
  return formatDistanceToNow(date, { addSuffix: true });
}
