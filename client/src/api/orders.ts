import { AxiosInstance } from 'axios';
import defaultApi from './axios';
import { Order, PaginatedResponse, ShippingAddress } from '../types';

/**
 * Orders API bound to a specific axios instance.
 *
 * `place` is the single most tenant-sensitive call in the client: it creates
 * the order, decrements the merchant's stock and starts the payment. Inside a
 * storefront it MUST run against that merchant's instance — the ambient
 * fallback previously routed it to the platform's own store.
 */
export function createOrdersApi(api: AxiosInstance = defaultApi) {
  return {
  // Neither the discount nor the shipping cost is sent by the client — the
  // server derives the discount from `couponCode` and the postage from
  // `shippingRateId`. Sending amounts here would be ignored (and previously
  // allowed order-total tampering).
  place: (
    shippingAddress: ShippingAddress,
    paymentMethod: 'online' | 'cod' = 'online',
    couponCode?: string,
    idempotencyKey?: string,
    shippingRateId?: string
  ) =>
    api.post<{ data: Order }>('/orders', {
      shippingAddress,
      paymentMethod,
      couponCode,
      idempotencyKey,
      shippingRateId,
    }),
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
}

export const ordersApi = createOrdersApi();
