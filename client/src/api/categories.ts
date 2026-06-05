import api from './axios';
import { Category } from '../types';

export const categoriesApi = {
  list: () => api.get<{ data: Category[] }>('/categories'),
  create: (data: { name: string; slug: string; parentId?: string }) =>
    api.post<{ data: Category }>('/categories', data),
  update: (id: string, data: Partial<Category>) =>
    api.put<{ data: Category }>(`/categories/${id}`, data),
  delete: (id: string) => api.delete(`/categories/${id}`),
};
