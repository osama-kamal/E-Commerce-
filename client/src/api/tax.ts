import api from './axios';
import { TaxRate } from '../types';

/**
 * Tax rate API — merchant configuration only.
 *
 * There is deliberately no public read endpoint. A shopper learns the
 * applicable tax through a priced quote or a placed order, never by browsing
 * the merchant's rate table.
 */
export const taxApi = {
  listRates: () => api.get<{ data: TaxRate[] }>('/tax/rates'),
  createRate: (data: Partial<TaxRate>) => api.post<{ data: TaxRate }>('/tax/rates', data),
  updateRate: (id: string, data: Partial<TaxRate>) =>
    api.put<{ data: TaxRate }>(`/tax/rates/${id}`, data),
  deleteRate: (id: string) => api.delete(`/tax/rates/${id}`),
};
