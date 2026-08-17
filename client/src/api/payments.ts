import { AxiosInstance } from 'axios';
import defaultApi from './axios';

/**
 * Payment API bound to a specific axios instance.
 *
 * Both endpoints move money against a specific tenant's order. Inside a
 * storefront, pass `useTenant().api` so the request carries that merchant's
 * slug explicitly rather than relying on the interceptor's ambient fallback —
 * which, when it fell through, pointed at the platform's own store.
 */
export function createPaymentsApi(instance: AxiosInstance = defaultApi) {
  return {
    // ── Stripe ──────────────────────────────────────────────────────────────
    createIntent: (orderId: string) =>
      instance.post<{ data: { clientSecret: string; paymentIntentId: string } }>(
        '/payments/intent', { orderId }
      ),

    // ── Paymob ──────────────────────────────────────────────────────────────
    // Returns iframeUrl and paymentToken for embedding the Paymob payment frame.
    initiatePaymob: (orderId: string) =>
      instance.post<{ data: { paymentToken: string; iframeUrl: string; paymobOrderId: string } }>(
        '/payments/paymob/initiate', { orderId }
      ),
  };
}

export const paymentsApi = createPaymentsApi();
