import api from './axios';
import { Order, PaginatedResponse, ShippingAddress } from '../types';

export const ordersApi = {
  place: (shippingAddress: ShippingAddress, paymentMethod: 'online' | 'cod' = 'online', discountAmount = 0, couponCode?: string, idempotencyKey?: string) =>
    api.post<{ data: Order }>('/orders', { shippingAddress, paymentMethod, discountAmount, couponCode, idempotencyKey }),
  getMyOrders: (page = 1, limit = 20) =>
    api.get<{ data: PaginatedResponse<Order> }>('/orders', { params: { page, limit } }),
  getById: (id: string) => api.get<{ data: Order }>(`/orders/${id}`),
  cancel: (id: string) => api.put<{ data: Order }>(`/orders/${id}/cancel`),
  // Admin
  getAll: (params: Record<string, string | number>) =>
    api.get<{ data: PaginatedResponse<Order> }>('/orders/admin/all', { params }),
  updateStatus: (id: string, status: string) =>
    api.put<{ data: Order }>(`/orders/admin/${id}/status`, { status }),
  bulkUpdateStatus: (ids: string[], status: string) =>
    api.put('/orders/admin/bulk/status', { ids, status }),
  bulkDelete: (ids: string[]) =>
    api.delete('/orders/admin/bulk/delete', { data: { ids } }),
};
