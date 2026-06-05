import axios from './axios';

export interface CouponData {
  code: string;
  type: 'percent' | 'fixed';
  discount: number;
  minOrderAmount?: number;
  maxUses?: number;
  isActive?: boolean;
  expiresAt?: string | null;
}

export const couponsApi = {
  validate: (code: string, subtotal: number) =>
    axios.post<{ success: true; data: { discount: number; label: string; code: string } }>(
      '/coupons/validate',
      { code, subtotal }
    ),

  list: () =>
    axios.get('/coupons'),

  create: (data: CouponData) =>
    axios.post('/coupons', data),

  update: (id: string, data: Partial<CouponData>) =>
    axios.put(`/coupons/${id}`, data),

  delete: (id: string) =>
    axios.delete(`/coupons/${id}`),
};
