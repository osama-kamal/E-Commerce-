import api from './axios';
import { DashboardStats, TopProduct, User, PaginatedResponse } from '../types';

export const adminApi = {
  getDashboard: (params?: { startDate?: string; endDate?: string }) =>
    api.get<{ data: DashboardStats }>('/admin/dashboard', { params }),
  getTopProducts: (params?: { limit?: number; startDate?: string; endDate?: string }) =>
    api.get<{ data: TopProduct[] }>('/admin/top-products', { params }),
  listUsers: (page = 1, limit = 20, role?: 'admin' | 'customer') =>
    api.get<{ data: PaginatedResponse<User> }>('/admin/users', {
      params: { page, limit, ...(role ? { role } : {}) },
    }),
  getUserById: (id: string) => api.get<{ data: User }>(`/admin/users/${id}`),
  toggleUserStatus: (id: string, isActive: boolean) =>
    api.put<{ data: User }>(`/admin/users/${id}/status`, { isActive }),
  updateUserRole: (id: string, role: 'admin' | 'customer') =>
    api.put<{ data: User }>(`/admin/users/${id}/role`, { role }),
  getLowStock: (threshold = 10, storeId?: string) =>
    api.get<{ data: { count: number; threshold: number; products: { _id: string; name: string; stock: number; images: string[] }[] } }>(
      '/admin/low-stock',
      {
        params: { threshold },
        headers: storeId ? { 'X-Store-ID': storeId } : undefined,
      }
    ),
};
