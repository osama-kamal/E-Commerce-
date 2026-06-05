import api from './axios';
import { Cart } from '../types';

export const cartApi = {
  get: () => api.get<{ data: Cart }>('/cart'),
  addItem: (productId: string, quantity: number, selectedSize?: string) =>
    api.post<{ data: Cart }>('/cart/items', { productId, quantity, selectedSize }),
  updateItem: (productId: string, quantity: number) =>
    api.put<{ data: Cart }>(`/cart/items/${productId}`, { quantity }),
  removeItem: (productId: string) => api.delete<{ data: Cart }>(`/cart/items/${productId}`),
  clear: () => api.delete<{ data: Cart }>('/cart'),
};
