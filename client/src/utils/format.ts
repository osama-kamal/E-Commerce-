import { formatDistanceToNow } from 'date-fns';

/**
 * Format a number as USD currency
 * @param value - The numeric value to format
 * @returns Formatted currency string (e.g., "$1,234.56" or "-$1,234.56")
 */
export function formatCurrency(value: number): string {
  const isNegative = value < 0;
  const absoluteValue = Math.abs(value);
  
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(absoluteValue);
  
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
