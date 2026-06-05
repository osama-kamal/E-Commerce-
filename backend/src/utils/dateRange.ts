/**
 * Date Range Utilities
 * 
 * Provides functions for validating and calculating date ranges
 * with UTC timezone handling and preset calculations.
 */

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export class DateRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DateRangeError';
  }
}

/**
 * Validate that a date range is valid
 * - Start date must be before or equal to end date
 * - Date range must not exceed 365 days
 */
export function validateDateRange(startDate: Date, endDate: Date): void {
  // Check if dates are valid
  if (isNaN(startDate.getTime())) {
    throw new DateRangeError('Invalid start date');
  }
  
  if (isNaN(endDate.getTime())) {
    throw new DateRangeError('Invalid end date');
  }

  // Check if start date is before or equal to end date
  if (startDate > endDate) {
    throw new DateRangeError('Start date must be before or equal to end date');
  }

  // Check if date range exceeds 365 days
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysDiff > 365) {
    throw new DateRangeError('Date range cannot exceed 365 days');
  }
}

/**
 * Parse date string to UTC Date object
 */
export function parseUTCDate(dateString: string): Date {
  const date = new Date(dateString);
  
  if (isNaN(date.getTime())) {
    throw new DateRangeError(`Invalid date format: ${dateString}`);
  }
  
  return date;
}

/**
 * Get start of day in UTC
 */
export function getStartOfDayUTC(date: Date): Date {
  const utcDate = new Date(date);
  utcDate.setUTCHours(0, 0, 0, 0);
  return utcDate;
}

/**
 * Get end of day in UTC
 */
export function getEndOfDayUTC(date: Date): Date {
  const utcDate = new Date(date);
  utcDate.setUTCHours(23, 59, 59, 999);
  return utcDate;
}

/**
 * Get date range for "Today" preset
 */
export function getTodayRange(): DateRange {
  const now = new Date();
  return {
    startDate: getStartOfDayUTC(now),
    endDate: getEndOfDayUTC(now),
  };
}

/**
 * Get date range for "Last 7 days" preset
 */
export function getLast7DaysRange(): DateRange {
  const now = new Date();
  const endDate = getEndOfDayUTC(now);
  
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - 6); // 6 days ago + today = 7 days
  
  return {
    startDate: getStartOfDayUTC(startDate),
    endDate,
  };
}

/**
 * Get date range for "Last 30 days" preset
 */
export function getLast30DaysRange(): DateRange {
  const now = new Date();
  const endDate = getEndOfDayUTC(now);
  
  const startDate = new Date(now);
  startDate.setUTCDate(startDate.getUTCDate() - 29); // 29 days ago + today = 30 days
  
  return {
    startDate: getStartOfDayUTC(startDate),
    endDate,
  };
}

/**
 * Get default date range (last 30 days)
 */
export function getDefaultDateRange(): DateRange {
  return getLast30DaysRange();
}

/**
 * Parse and validate date range from query parameters
 * Returns default range if parameters are missing
 */
export function parseDateRangeFromQuery(
  startDateStr?: string,
  endDateStr?: string
): DateRange {
  // If both parameters are missing, return default range
  if (!startDateStr && !endDateStr) {
    return getDefaultDateRange();
  }

  // If only one parameter is provided, throw error
  if (!startDateStr || !endDateStr) {
    throw new DateRangeError('Both startDate and endDate must be provided');
  }

  // Parse dates
  const startDate = parseUTCDate(startDateStr);
  const endDate = parseUTCDate(endDateStr);

  // Validate range
  validateDateRange(startDate, endDate);

  return {
    startDate: getStartOfDayUTC(startDate),
    endDate: getEndOfDayUTC(endDate),
  };
}

/**
 * Calculate previous period date range for comparison
 * Returns a date range of equal length immediately before the given range
 */
export function getPreviousPeriodRange(startDate: Date, endDate: Date): DateRange {
  const periodLength = endDate.getTime() - startDate.getTime();
  
  const previousEndDate = new Date(startDate.getTime() - 1); // 1ms before start
  const previousStartDate = new Date(previousEndDate.getTime() - periodLength);
  
  return {
    startDate: getStartOfDayUTC(previousStartDate),
    endDate: getEndOfDayUTC(previousEndDate),
  };
}

/**
 * Calculate percentage change between two values
 * Returns "N/A" string if previous value is zero
 */
export function calculatePercentageChange(current: number, previous: number): number | string {
  if (previous === 0) {
    return 'N/A';
  }
  
  return Math.round(((current - previous) / previous) * 100 * 100) / 100; // Round to 2 decimals
}

/**
 * Format date to ISO string for cache keys
 */
export function formatDateForCacheKey(date: Date): string {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}
