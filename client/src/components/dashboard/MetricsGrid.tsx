import React from 'react';
import { formatCurrency } from '../../utils/format';

interface MetricCardProps {
  title: string;
  value: string | number;
  previousValue?: number;
  percentageChange?: number | string;
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  icon?: React.ReactNode;
  format?: 'currency' | 'number' | 'percentage';
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  previousValue,
  percentageChange,
  isLoading,
  error,
  onRetry,
  icon,
  format = 'number',
}) => {
  const formatValue = (val: string | number): string => {
    if (typeof val === 'string') return val;
    
    switch (format) {
      case 'currency':
        return formatCurrency(val);
      case 'percentage':
        return `${val.toFixed(2)}%`;
      default:
        return val.toLocaleString();
    }
  };

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
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/2"></div>
          {icon && <div className="h-8 w-8 bg-gray-300 dark:bg-gray-600 rounded"></div>}
        </div>
        <div className="h-8 bg-gray-300 dark:bg-gray-600 rounded w-3/4 mb-2"></div>
        <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-1/3"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</h3>
          {icon && <div className="text-gray-400">{icon}</div>}
        </div>
        <div className="text-red-600 dark:text-red-400 text-sm mb-2">
          Failed to load data
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">{title}</h3>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      
      <div className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
        {formatValue(value)}
      </div>
      
      {percentageChange !== undefined && (
        <div className="flex items-center space-x-1">
          <span className={`text-sm font-medium ${getChangeColor(percentageChange)}`}>
            {getChangeIcon(percentageChange)} {formatChange(percentageChange)}%
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            vs previous period
          </span>
        </div>
      )}
    </div>
  );
};

interface MetricsGridProps {
  revenue?: {
    current: number;
    previous?: number;
    change?: number | string;
  };
  orders?: {
    current: number;
    previous?: number;
    change?: number | string;
  };
  aov?: {
    current: number;
    previous?: number;
    change?: number | string;
  };
  conversionRate?: {
    current: number;
    previous?: number;
    change?: number | string;
  };
  isLoading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

export const MetricsGrid: React.FC<MetricsGridProps> = ({
  revenue,
  orders,
  aov,
  conversionRate,
  isLoading = false,
  error = null,
  onRetry,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      <MetricCard
        title="Total Revenue"
        value={revenue?.current ?? 0}
        previousValue={revenue?.previous}
        percentageChange={revenue?.change}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        format="currency"
        icon={
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
      
      <MetricCard
        title="Total Orders"
        value={orders?.current ?? 0}
        previousValue={orders?.previous}
        percentageChange={orders?.change}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        format="number"
        icon={
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
        }
      />
      
      <MetricCard
        title="Average Order Value"
        value={aov?.current ?? 0}
        previousValue={aov?.previous}
        percentageChange={aov?.change}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        format="currency"
        icon={
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        }
      />
      
      <MetricCard
        title="Conversion Rate"
        value={conversionRate?.current ?? 0}
        previousValue={conversionRate?.previous}
        percentageChange={conversionRate?.change}
        isLoading={isLoading}
        error={error}
        onRetry={onRetry}
        format="percentage"
        icon={
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
        }
      />
    </div>
  );
};
