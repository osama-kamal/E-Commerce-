import api from './axios';
import { Review } from '../types';

export const reviewsApi = {
  getForProduct: (productId: string) =>
    api.get<{ data: { reviews: Review[]; averageRating: number; total: number } }>(
      `/reviews/products/${productId}`
    ),
  submit: (productId: string, rating: number, comment: string) =>
    api.post<{ data: Review }>(`/reviews/products/${productId}`, { rating, comment }),
  delete: (id: string) => api.delete(`/reviews/${id}`),
};
