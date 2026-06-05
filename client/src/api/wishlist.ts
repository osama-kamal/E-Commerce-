import api from './axios';
import { Wishlist } from '../types';

export const wishlistApi = {
  get: () => api.get<{ data: Wishlist }>('/wishlist'),
  add: (productId: string) => api.post<{ data: Wishlist }>(`/wishlist/${productId}`),
  remove: (productId: string) => api.delete<{ data: Wishlist }>(`/wishlist/${productId}`),
  moveToCart: (productId: string) =>
    api.post<{ data: Wishlist }>(`/wishlist/${productId}/move-to-cart`),
};
