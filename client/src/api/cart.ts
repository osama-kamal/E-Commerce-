import { AxiosInstance } from 'axios';
import defaultApi from './axios';
import { Cart } from '../types';

/**
 * Cart API bound to a specific axios instance.
 *
 * The instance carries the tenant. Inside a storefront that is the
 * slug-scoped instance from `useTenant()`; elsewhere it is the global
 * singleton, whose interceptor resolves the admin-selected store.
 *
 * Binding explicitly matters here more than anywhere else in the client: the
 * cart is the one resource a shopper mutates on a storefront they do not own,
 * and routing a write to the wrong tenant puts items in a stranger's basket.
 */
export function createCartApi(instance: AxiosInstance = defaultApi) {
  return {
    get: () => instance.get<{ data: Cart }>('/cart'),
    addItem: (productId: string, quantity: number, selectedSize?: string) =>
      instance.post<{ data: Cart }>('/cart/items', { productId, quantity, selectedSize }),
    updateItem: (productId: string, quantity: number) =>
      instance.put<{ data: Cart }>(`/cart/items/${productId}`, { quantity }),
    removeItem: (productId: string) => instance.delete<{ data: Cart }>(`/cart/items/${productId}`),
    clear: () => instance.delete<{ data: Cart }>('/cart'),
  };
}

export type CartApi = ReturnType<typeof createCartApi>;

/**
 * Global-instance cart API.
 *
 * Retained for call sites outside any storefront. Inside one, prefer
 * `createCartApi(useTenant().api)` — this singleton depends on the ambient
 * sessionStorage fallback, which is a safety net rather than a guarantee.
 */
export const cartApi = createCartApi();
