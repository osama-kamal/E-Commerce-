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
import { CustomerMetricsResult } from '../../types';

interface CustomerAcquisitionChartProps {
  data?: CustomerMetricsResult;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const CustomerAcquisitionChart: React.FC<CustomerAcquisitionChartProps> = ({
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
            New Customers: <span className="font-semibold text-blue-600 dark:text-blue-400">{data.newCustomers}</span>
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
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Customer Acquisition</h3>
        <div className="flex flex-col items-center justify-center h-80 text-center">
          <svg className="w-16 h-16 text-red-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 mb-2">Failed to load customer acquisition data</p>
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

  if (!data || data.acquisitionTrend.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Customer Acquisition</h3>
        <div className="flex flex-col items-center justify-center h-80 text-center">
          <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400">No customer acquisition data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Customer Acquisition</h3>
        <div className="flex flex-wrap gap-4 mt-2 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">New Customers: </span>
            <span className="font-semibold text-gray-900 dark:text-white">{data.newCustomers}</span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Repeat Rate: </span>
            <span className="font-semibold text-gray-900 dark:text-white">{data.repeatCustomerRate.toFixed(2)}%</span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Churn Rate: </span>
            <span className="font-semibold text-gray-900 dark:text-white">{data.churnRate.toFixed(2)}%</span>
          </div>
          {data.previousPeriod && (
            <div>
              <span className="text-gray-600 dark:text-gray-400">vs Previous: </span>
              <span className={`font-semibold ${typeof data.previousPeriod.percentageChange === 'number' && data.previousPeriod.percentageChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {typeof data.previousPeriod.percentageChange === 'number' && data.previousPeriod.percentageChange >= 0 ? '+' : ''}
                {typeof data.previousPeriod.percentageChange === 'number' ? data.previousPeriod.percentageChange.toFixed(2) : data.previousPeriod.percentageChange}%
              </span>
            </div>
          )}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data.acquisitionTrend} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) => format(new Date(date), 'MMM dd')}
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <YAxis
            className="text-gray-600 dark:text-gray-400"
            tick={{ fill: 'currentColor' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="newCustomers"
            stroke="#3B82F6"
            strokeWidth={2}
            dot={{ fill: '#3B82F6', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
