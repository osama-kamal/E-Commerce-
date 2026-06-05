import React from 'react';
import { formatCurrency } from '../../utils/format';
import { TodayMetricsResult } from '../../types';

interface TodayMetricsCardProps {
  data?: TodayMetricsResult;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const TodayMetricsCard: React.FC<TodayMetricsCardProps> = ({
  data,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const getChangeColor = (change: number | string): string => {
    if (typeof change === 'string') return 'text-gray-600 dark:text-gray-400';
    if (change > 0) return 'text-green-600 dark:text-green-400';
    if (change < 0) return 'text-red-600 dark:text-red-400';
    return 'text-gray-600 dark:text-gray-400';
  };

  const getChangeIcon = (change: number | string): string => {
    if (typeof change === 'string') return '→';
    if (change > 0) return '↑';
    if (change < 0) return '↓';
    return '→';
  };

  const formatChange = (change: number | string): string => {
    if (typeof change === 'string') return change;
    return Math.abs(change).toFixed(2);
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 animate-pulse">
        <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4"></div>
        <div className="space-y-4">
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Today's Metrics</h3>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg className="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 text-sm mb-2">Failed to load today's metrics</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Today's Metrics</h3>
        <p className="text-gray-600 dark:text-gray-400 text-sm">No data available</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Today's Metrics</h3>
      
      <div className="space-y-4">
        {/* Revenue */}
        <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600 dark:text-gray-400">Revenue</span>
            <span className={`text-sm font-medium ${getChangeColor(data.changes.revenueChange)}`}>
              {getChangeIcon(data.changes.revenueChange)} {formatChange(data.changes.revenueChange)}%
            </span>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatCurrency(data.today.revenue)}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              vs {formatCurrency(data.yesterday.revenue)}
            </span>
          </div>
        </div>

        {/* Orders */}
        <div className="pb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-600 dark:text-gray-400">Orders</span>
            <span className={`text-sm font-medium ${getChangeColor(data.changes.orderCountChange)}`}>
              {getChangeIcon(data.changes.orderCountChange)} {formatChange(data.changes.orderCountChange)}%
            </span>
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-gray-900 dark:text-white">
              {data.today.orderCount}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">
              vs {data.yesterday.orderCount}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
