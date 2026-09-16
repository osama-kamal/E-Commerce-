import { AxiosInstance } from 'axios';
import defaultApi from './axios';
import { ShippingZone, ShippingRate, ShippingQuote } from '../types';

/**
 * Quote endpoint bound to a specific axios instance.
 *
 * Split out from the merchant CRUD below because it is the only shipping call a
 * SHOPPER makes, and it must be priced against the right merchant's rates —
 * pass `useTenant().api` inside a storefront.
 */
export function createShippingQuoteApi(instance: AxiosInstance = defaultApi) {
  return {
    quote: (country: string, state?: string, couponCode?: string, shippingRateId?: string) =>
      instance.post<{ data: ShippingQuote }>(
        '/shipping/quote',
        { country, state, shippingRateId },
        { params: couponCode ? { couponCode } : undefined }
      ),
  };
}

/**
 * Shipping API on the global instance.
 *
 * The merchant CRUD below is admin-only and always runs on the main site
 * (/admin/shipping), where the global instance's store resolution is correct.
 * `quote` is kept here for main-site checkout; inside a storefront use
 * `createShippingQuoteApi(useTenant().api)` instead.
 *
 * Note what is absent from `quote`: the cart contents and the subtotal. The
 * server prices the quote against the caller's own cart, so a client cannot
 * claim a basket large enough to clear a free-delivery threshold.
 */
export const shippingApi = {
  ...createShippingQuoteApi(defaultApi),

  // ── Merchant configuration ──────────────────────────────────────────────────
  listZones: () => defaultApi.get<{ data: ShippingZone[] }>('/shipping/zones'),
  createZone: (data: Partial<ShippingZone>) =>
    defaultApi.post<{ data: ShippingZone }>('/shipping/zones', data),
  updateZone: (id: string, data: Partial<ShippingZone>) =>
    defaultApi.put<{ data: ShippingZone }>(`/shipping/zones/${id}`, data),
  deleteZone: (id: string) => defaultApi.delete(`/shipping/zones/${id}`),

  listRates: (zoneId?: string) =>
    defaultApi.get<{ data: ShippingRate[] }>('/shipping/rates', {
      params: zoneId ? { zoneId } : undefined,
    }),
  createRate: (data: Partial<ShippingRate>) =>
    defaultApi.post<{ data: ShippingRate }>('/shipping/rates', data),
  updateRate: (id: string, data: Partial<ShippingRate>) =>
    defaultApi.put<{ data: ShippingRate }>(`/shipping/rates/${id}`, data),
  deleteRate: (id: string) => defaultApi.delete(`/shipping/rates/${id}`),
};
