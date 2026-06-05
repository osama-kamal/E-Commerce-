import api from './axios';
import {
  SalesTrendsResult,
  CategoryPerformanceResult,
  CustomerMetricsResult,
  AOVMetricsResult,
  ConversionMetricsResult,
  TodayMetricsResult,
  RecentOrdersResult,
  RevenueGoalResult,
} from '../types';

export const analyticsApi = {
  getSalesTrends: (params: {
    startDate: string;
    endDate: string;
    granularity: 'daily' | 'weekly' | 'monthly';
    categoryId?: string;
  }) =>
    api.get<{ data: SalesTrendsResult }>('/admin/analytics/sales-trends', { params }),

  getCategoryPerformance: (params: { startDate: string; endDate: string }) =>
    api.get<{ data: CategoryPerformanceResult }>('/admin/analytics/category-performance', { params }),

  getCustomerMetrics: (params: { startDate: string; endDate: string }) =>
    api.get<{ data: CustomerMetricsResult }>('/admin/analytics/customer-metrics', { params }),

  getAOVMetrics: (params: { startDate: string; endDate: string }) =>
    api.get<{ data: AOVMetricsResult }>('/admin/analytics/aov-metrics', { params }),

  getConversionMetrics: (params: { startDate: string; endDate: string }) =>
    api.get<{ data: ConversionMetricsResult }>('/admin/analytics/conversion-metrics', { params }),

  getTodayMetrics: () =>
    api.get<{ data: TodayMetricsResult }>('/admin/analytics/today-metrics'),

  getRecentOrders: (params?: { limit?: number }) =>
    api.get<{ data: RecentOrdersResult }>('/admin/analytics/recent-orders', { params }),

  getRevenueGoal: (params: { period: 'daily' | 'weekly' | 'monthly' }) =>
    api.get<{ data: RevenueGoalResult }>('/admin/analytics/revenue-goal', { params }),
};
