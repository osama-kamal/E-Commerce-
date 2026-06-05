import api from './axios';

export const paymentsApi = {
  createIntent: (orderId: string) =>
    api.post<{ data: { clientSecret: string; paymentIntentId: string } }>(
      '/payments/intent', { orderId }
    ),
};
