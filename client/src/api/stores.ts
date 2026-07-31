import api from './axios';
import axios from 'axios';
import { Store, StoreSettings, StoreTheme } from '../types';

export interface UpdateSettingsPayload extends Partial<StoreSettings> {
  name?: string;
  /**
   * Storefront presentation theme. Sent to the same PATCH /stores/:id/settings
   * endpoint as everything else — no new route. The server writes it to the
   * document root (not into `settings`) and rejects unknown values with a 400.
   */
  theme?: StoreTheme;
}

export const storesApi = {
  // Get current store (public — uses X-Store-ID header set by interceptor)
  getCurrent: () => api.get<{ data: Store }>('/stores/current'),

  // List all stores owned by the authenticated user
  getMine: () => api.get<{ data: Store[] }>('/stores/mine'),

  // Update store settings (owner only)
  updateSettings: (storeId: string, payload: UpdateSettingsPayload) =>
    api.patch<{ data: Store }>(`/stores/${storeId}/settings`, payload),

  // Upload logo to Cloudinary via backend (reuses the product image upload pattern)
  uploadLogo: async (storeId: string, file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('image', file);

    const storeIdHeader = localStorage.getItem('currentStoreId') || import.meta.env.VITE_STORE_ID || '';
    const token = localStorage.getItem('accessToken') || '';

    const res = await axios.post<{ data: { imageUrl: string } }>(
      `/api/v1/stores/${storeId}/logo`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
          Authorization: `Bearer ${token}`,
          'X-Store-ID': storeIdHeader,
        },
      }
    );
    return res.data.data.imageUrl;
  },
  // Update store plan (super-admin only)
  updatePlan: (storeId: string, plan: string, status: string) =>
    api.patch<{ data: Store }>(`/admin/stores/${storeId}/plan`, { plan, status }),

  // List all stores (super-admin)
  listAllStores: (page = 1, limit = 50) =>
    api.get<{ data: { data: Store[]; total: number } }>('/admin/stores', { params: { page, limit } }),

  // Request plan upgrade (owner)
  requestUpgrade: (storeId: string, requestedPlan: string) =>
    api.post<{ data: { message: string; requestedPlan: string } }>(`/stores/${storeId}/upgrade-request`, { requestedPlan }),
};
