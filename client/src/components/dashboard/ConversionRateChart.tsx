import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { format } from 'date-fns';
import { ConversionMetricsResult } from '../../types';

interface ConversionRateChartProps {
  data?: ConversionMetricsResult;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const ConversionRateChart: React.FC<ConversionRateChartProps> = ({
  data,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
          <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
            {format(new Date(data.date), 'PPP')}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Conversion Rate: <span className="font-semibold text-purple-600 dark:text-purple-400">{data.conversionRate.toFixed(2)}%</span>
          </p>
        </div>
      );
    }
    return null;
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4 animate-pulse"></div>
        <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Conversion Rate Trend</h3>
        <div className="flex flex-col items-center justify-center h-80 text-center">
          <svg className="w-16 h-16 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 mb-2">Failed to load conversion rate data</p>
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

  if (!data || data.trend.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Conversion Rate Trend</h3>
        <div className="flex flex-col items-center justify-center h-80 text-center">
          <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400">Insufficient data to calculate conversion rate</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            Conversion rate requires visitor tracking data
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Conversion Rate Trend</h3>
        <div className="flex flex-wrap gap-4 mt-2 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">Current Rate: </span>
            <span className="font-semibold text-gray-900 dark:text-white">{data.conversionRate.toFixed(2)}%</span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Previous Rate: </span>
            <span className="font-semibold text-gray-900 dark:text-white">{data.previousConversionRate.toFixed(2)}%</span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Change: </span>
            <span className={`font-semibold ${typeof data.percentageChange === 'number' && data.percentageChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {typeof data.percentageChange === 'number' && data.percentageChange >= 0 ? '+' : ''}
              {typeof data.percentageChange === 'number' ? data.percentageChange.toFixed(2) : data.percentageChange}%
            </span>
          </div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data.trend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) => format(new Date(date), 'MMM dd')}
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <YAxis
            tickFormatter={(value) => `${value.toFixed(2)}%`}
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="conversionRate"
            stroke="#8B5CF6"
            strokeWidth={2}
            dot={{ fill: '#8B5CF6', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
