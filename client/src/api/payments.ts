import api from './axios';

export const paymentsApi = {
  // ── Stripe ────────────────────────────────────────────────────────────────
  createIntent: (orderId: string) =>
    api.post<{ data: { clientSecret: string; paymentIntentId: string } }>(
      '/payments/intent', { orderId }
    ),

  // ── Paymob ───────────────────────────────────────────────────────────────
  // Returns iframeUrl and paymentToken for embedding the Paymob payment frame.
  initiatePaymob: (orderId: string) =>
    api.post<{ data: { paymentToken: string; iframeUrl: string; paymobOrderId: string } }>(
      '/payments/paymob/initiate', { orderId }
    ),
};
