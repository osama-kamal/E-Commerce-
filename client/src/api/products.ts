import api from './axios';
import { Product, PaginatedResponse } from '../types';

export interface ProductFilters {
  page?: number;
  limit?: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  search?: string;
  onSale?: boolean; // Filter for products with discount
  sortBy?: string; // Sort option
}

export const productsApi = {
  list: (filters: ProductFilters = {}) =>
    api.get<{ data: PaginatedResponse<Product> }>('/products', { params: filters }),
  getById: (id: string) => api.get<{ data: Product }>(`/products/${id}`),
  create: (data: { name: string; description: string; price: number; stock: number; categoryId: string }) =>
    api.post<{ data: Product }>('/products', data),
  update: (id: string, data: Partial<Product>) =>
    api.put<{ data: Product }>(`/products/${id}`, data),
  delete: (id: string) => api.delete(`/products/${id}`),
  bulkDelete: (ids: string[]) => api.post('/products/bulk/delete', { ids }),
  bulkUpdate: (ids: string[], updates: { price?: number; stock?: number; discount?: number; categoryId?: string }) =>
    api.put('/products/bulk/update', { ids, updates }),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('image', file);
    return api.post<{ data: { imageUrl: string } }>(`/products/${id}/images`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
