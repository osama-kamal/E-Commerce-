import axios from 'axios';
import toast from 'react-hot-toast';
import { store } from '../store';
import { logout, setTokens } from '../store/authSlice';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  // withCredentials = true is required so the browser sends the httpOnly
  // refresh-token cookie on every request (including the /auth/refresh call).
  withCredentials: true,
});

// ── Request interceptor ───────────────────────────────────────────────────────
// Attach access token + store context to every request.
// Falls back to localStorage in case Redux store hasn't hydrated yet (page refresh).
api.interceptors.request.use((config) => {
  const token = store.getState().auth.accessToken ?? localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Multi-tenant: attach the store identifier so the backend can resolve the tenant.
  const currentStoreId = localStorage.getItem('currentStoreId');
  const envStoreId = import.meta.env.VITE_STORE_ID as string | undefined;
  const storeSlug = import.meta.env.VITE_STORE_SLUG as string | undefined;

  const storeId = currentStoreId || envStoreId;

  // Guard: only send X-Store-ID if it's a valid 24-char MongoDB ObjectId.
  const isValidObjectId = (id: string | undefined | null): id is string =>
    typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

  if (isValidObjectId(storeId)) {
    config.headers['X-Store-ID'] = storeId;
  } else if (storeSlug) {
    config.headers['X-Store-Slug'] = storeSlug;
  }

  return config;
});

// ── Response interceptor — silent token refresh on 401 ───────────────────────
let isRefreshing = false;
let failedQueue: Array<{ resolve: (v: string) => void; reject: (e: unknown) => void }> = [];

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const message: string = error.response?.data?.message ?? 'Something went wrong';

    // Auth endpoints (login, register, reset-password) legitimately return 401
    // for bad credentials — don't attempt a silent token refresh for those.
    const isAuthEndpoint = original.url &&
      (original.url.includes('/auth/login') ||
       original.url.includes('/auth/register') ||
       original.url.includes('/auth/reset-password') ||
       original.url.includes('/auth/forgot-password'));

    if (status === 401 && !original._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        // Another refresh is already in flight — queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          original.headers.Authorization = `Bearer ${token}`;
          return api(original);
        });
      }

      original._retry = true;
      isRefreshing = true;

      try {
        // The refresh token is sent automatically via the httpOnly cookie.
        // No body payload needed — withCredentials handles the cookie.
        const { data } = await axios.post(
          '/api/v1/auth/refresh',
          {},
          { withCredentials: true }
        );

        const { accessToken } = data.data;
        // Backend rotates the refresh cookie server-side — we only handle the new access token
        store.dispatch(setTokens({ accessToken }));
        processQueue(null, accessToken);
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (err) {
        processQueue(err, null);
        store.dispatch(logout());
        return Promise.reject(err);
      } finally {
        isRefreshing = false;
      }
    }

    // Show toast for all errors except 401s that are being retried via refresh.
    // Auth endpoint 401s (wrong password, etc.) should always show the error message.
    const willRetry = status === 401 && !original._retry && !isAuthEndpoint;
    if (!willRetry) {
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

export default api;
