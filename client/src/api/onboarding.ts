import axios from 'axios';

// Onboarding uses a plain axios instance (no store header needed — this creates the store)
const plainApi = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

export interface OnboardingPayload {
  fullName: string;
  email: string;
  password: string;
  storeName: string;
  storeCategory: string;
  storeSlug?: string;
}

export interface OnboardingResponse {
  store: { _id: string; name: string; slug: string; subscriptionPlan: string };
  user: { _id: string; email: string; fullName: string; role: string };
  accessToken: string;
  refreshToken: string;
}

export const onboardingApi = {
  createStore: (payload: OnboardingPayload) =>
    plainApi.post<{ success: boolean; data: OnboardingResponse }>('/onboarding', payload),
};
