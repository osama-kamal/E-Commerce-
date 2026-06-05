import React from 'react';
import { formatCurrency, formatRelativeTime } from '../../utils/format';
import { RecentOrdersResult } from '../../types';

interface RecentOrdersFeedProps {
  data?: RecentOrdersResult;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const RecentOrdersFeed: React.FC<RecentOrdersFeedProps> = ({
  data,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  const getStatusColor = (status: string): string => {
    const colors = {
      pending: 'text-yellow-600 dark:text-yellow-400',
      processing: 'text-blue-600 dark:text-blue-400',
      shipped: 'text-purple-600 dark:text-purple-400',
      delivered: 'text-green-600 dark:text-green-400',
      cancelled: 'text-red-600 dark:text-red-400',
    };
    return colors[status as keyof typeof colors] || 'text-gray-600 dark:text-gray-400';
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded w-1/3 mb-4 animate-pulse"></div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center space-x-3">
              <div className="h-10 w-10 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse"></div>
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 animate-pulse"></div>
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 animate-pulse"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Recent Orders</h3>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg className="w-12 h-12 text-red-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-red-600 dark:text-red-400 text-sm mb-2">Failed to load recent orders</p>
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

  if (!data || data.orders.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Recent Orders</h3>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg className="w-12 h-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          <p className="text-gray-600 dark:text-gray-400 text-sm">No recent orders</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Recent Orders</h3>
      
      <div className="space-y-4">
        {data.orders.map((order) => (
          <div 
            key={order.orderId} 
            className="flex items-start space-x-3 pb-4 border-b border-gray-200 dark:border-gray-700 last:border-0 last:pb-0"
          >
            <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {order.customerName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                    #{order.orderId.slice(-8)}
                  </p>
                </div>
                <div className="ml-2 flex-shrink-0 text-right">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {formatCurrency(order.totalAmount)}
                  </p>
                </div>
              </div>
              
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className={`font-medium ${getStatusColor(order.status)}`}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {formatRelativeTime(order.createdAt)}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
