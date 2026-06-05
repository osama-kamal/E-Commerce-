import React from 'react';
import { formatCurrency } from '../../utils/format';
import { RevenueGoalResult } from '../../types';

interface RevenueGoalProgressProps {
  data?: RevenueGoalResult;
  period: 'daily' | 'weekly' | 'monthly';
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const RevenueGoalProgress: React.FC<RevenueGoalProgressProps> = ({
  data,
  period,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const getPeriodLabel = (period: string): string => {
    const labels = {
      daily: 'Daily',
      weekly: 'Weekly',
      monthly: 'Monthly',
    };
    return labels[period as keyof typeof labels] || period;
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 animate-pulse">
        <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/2 mb-4"></div>
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Revenue Goal</h3>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg className="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 text-sm mb-2">Failed to load revenue goal</p>
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

  if (!data || data.goalAmount === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Revenue Goal</h3>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400 text-sm mb-1">No revenue goal set</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Set a {getPeriodLabel(period).toLowerCase()} revenue goal to track progress
          </p>
        </div>
      </div>
    );
  }

  const displayPercentage = Math.min(data.percentage, 100);
  const isExceeded = data.isExceeded;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {getPeriodLabel(period)} Revenue Goal
        </h3>
        {isExceeded && (
          <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full">
            Goal Exceeded!
          </span>
        )}
      </div>

      <div className="space-y-3">
        {/* Progress Bar */}
        <div className="relative">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600 dark:text-gray-400">Progress</span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {data.percentage.toFixed(1)}%
            </span>
          </div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isExceeded
                  ? 'bg-gradient-to-r from-green-500 to-green-600'
                  : data.percentage >= 75
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600'
                  : data.percentage >= 50
                  ? 'bg-gradient-to-r from-yellow-500 to-yellow-600'
                  : 'bg-gradient-to-r from-red-500 to-red-600'
              }`}
              style={{ width: `${displayPercentage}%` }}
            ></div>
          </div>
        </div>

        {/* Revenue Details */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Current</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {formatCurrency(data.currentRevenue)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-gray-400">Goal</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {formatCurrency(data.goalAmount)}
            </p>
          </div>
        </div>

        {/* Remaining Amount */}
        {!isExceeded && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">Remaining</p>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              {formatCurrency(data.goalAmount - data.currentRevenue)}
            </p>
          </div>
        )}

        {/* Overflow Amount */}
        {isExceeded && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500 dark:text-gray-400">Over Goal</p>
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">
              +{formatCurrency(data.currentRevenue - data.goalAmount)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
