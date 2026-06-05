import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { formatCurrency } from '../../utils/format';
import { SalesTrendsResult } from '../../types';

interface SalesTrendChartProps {
  data?: SalesTrendsResult;
  granularity: 'daily' | 'weekly' | 'monthly';
  onGranularityChange: (granularity: 'daily' | 'weekly' | 'monthly') => void;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const SalesTrendChart: React.FC<SalesTrendChartProps> = ({
  data,
  granularity,
  onGranularityChange,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const formatXAxis = (dateString: string) => {
    const date = new Date(dateString);
    switch (granularity) {
      case 'daily':
        return format(date, 'MMM dd');
      case 'weekly':
        return format(date, 'MMM dd');
      case 'monthly':
        return format(date, 'MMM yyyy');
      default:
        return dateString;
    }
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            {format(new Date(data.date), 'PPP')}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Revenue: <span className="font-semibold text-blue-600 dark:text-blue-400">{formatCurrency(data.revenue)}</span>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Orders: <span className="font-semibold text-green-600 dark:text-green-400">{data.orderCount}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 animate-pulse"></div>
          <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-1/4 animate-pulse"></div>
        </div>
        <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Sales Trends</h3>
        <div className="flex flex-col items-center justify-center h-80 text-center">
          <svg className="w-16 h-16 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 mb-2">Failed to load sales trends</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">{error.message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data || data.trends.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sales Trends</h3>
          <div className="flex space-x-2">
            <button
              onClick={() => onGranularityChange('daily')}
              className={`px-3 py-1 text-sm rounded ${
                granularity === 'daily'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => onGranularityChange('weekly')}
              className={`px-3 py-1 text-sm rounded ${
                granularity === 'weekly'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              Weekly
            </button>
            <button
              onClick={() => onGranularityChange('monthly')}
              className={`px-3 py-1 text-sm rounded ${
                granularity === 'monthly'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              Monthly
            </button>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-80 text-center">
          <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400">No data available for the selected period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 space-y-2 sm:space-y-0">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sales Trends</h3>
          {data.previousPeriod && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Previous period: {formatCurrency(data.previousPeriod.revenue)} (
              <span className={typeof data.previousPeriod.percentageChange === 'number' && data.previousPeriod.percentageChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                {typeof data.previousPeriod.percentageChange === 'number' && data.previousPeriod.percentageChange >= 0 ? '+' : ''}
                {typeof data.previousPeriod.percentageChange === 'number' ? data.previousPeriod.percentageChange.toFixed(2) : data.previousPeriod.percentageChange}%
              </span>
              )
            </p>
          )}
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => onGranularityChange('daily')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              granularity === 'daily'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => onGranularityChange('weekly')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              granularity === 'weekly'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => onGranularityChange('monthly')}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              granularity === 'monthly'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Monthly
          </button>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={data.trends} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <YAxis
            yAxisId="left"
            tickFormatter={(value) => formatCurrency(value)}
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="revenue"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={{ fill: '#3B82F6', r: 4 }}
            activeDot={{ r: 6 }}
            name="Revenue"
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="orderCount"
            stroke="#10B981"
            strokeWidth={2}
            dot={{ fill: '#10B981', r: 4 }}
            activeDot={{ r: 6 }}
            name="Orders"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
