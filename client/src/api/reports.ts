import api from './axios';
import {
  InventoryReportResult,
  SalesReportResult,
  ProductPerformanceResult,
} from '../types';

export const reportsApi = {
  getInventoryReport: (params: {
    status?: 'low' | 'out' | 'overstocked' | 'all';
    page?: number;
    limit?: number;
    search?: string;
  }) =>
    api.get<{ data: InventoryReportResult }>('/admin/reports/inventory', { params }),

  exportInventoryReport: (params: {
    status?: 'low' | 'out' | 'overstocked' | 'all';
    search?: string;
  }) =>
    api.get('/admin/reports/inventory/export', {
      params,
      responseType: 'blob',
    }),

  getSalesReport: (params: {
    startDate: string;
    endDate: string;
    page?: number;
    limit?: number;
    search?: string;
  }) =>
    api.get<{ data: SalesReportResult }>('/admin/reports/sales', { params }),

  exportSalesReport: (params: { startDate: string; endDate: string }) =>
    api.get('/admin/reports/sales/export', {
      params,
      responseType: 'blob',
    }),

  getProductPerformance: (params: {
    startDate: string;
    endDate: string;
    type: 'best' | 'worst';
    limit?: number;
  }) =>
    api.get<{ data: ProductPerformanceResult }>('/admin/reports/product-performance', { params }),
};
