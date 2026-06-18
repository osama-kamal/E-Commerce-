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
  //
  // Priority order:
  //  1. Storefront slug in sessionStorage (set by StorefrontProvider while inside /s/:slug)
  //     This MUST take precedence — otherwise VITE_STORE_ID would always win and
  //     override it with the platform store's ID, breaking storefront cart/wishlist.
  //  2. currentStoreId in localStorage (vendor admin session — explicit user selection)
  //  3. VITE_STORE_ID env var (legacy single-store fallback, only when nothing else is set)
  //  4. VITE_STORE_SLUG env var (build-time slug, last resort)

  const storefrontSlug = sessionStorage.getItem('sf_active_slug');

  if (storefrontSlug) {
    // Inside a /s/:slug storefront — always use the slug, ignore everything else
    config.headers['X-Store-Slug'] = storefrontSlug;
  } else {
    const currentStoreId = localStorage.getItem('currentStoreId');
    const envStoreId = import.meta.env.VITE_STORE_ID as string | undefined;
    const storeSlug = import.meta.env.VITE_STORE_SLUG as string | undefined;

    const storeId: string | undefined = currentStoreId || envStoreId;

    // Guard: only send X-Store-ID if it's a valid 24-char MongoDB ObjectId.
    // Intentionally returns boolean (not a type predicate) so TypeScript does not
    // narrow storeId to never in the else-branch, which would break .length access.
    const isValidObjectId = (id: string | undefined | null): boolean =>
      typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

    if (isValidObjectId(storeId)) {
      config.headers['X-Store-ID'] = storeId as string;
    } else {
      if (storeId) {
        // The ID is present but invalid — warn loudly so typos are caught immediately.
        // A bad ID means resolveStore will skip it and return 404 for all tenant routes.
        console.error(
          `[axios] ⚠️ currentStoreId in localStorage is NOT a valid 24-char ObjectId ` +
          `(got "${storeId}", length ${storeId.length}). ` +
          `All API calls will return 404 until a valid ID is set. ` +
          `Fix: localStorage.setItem('currentStoreId', 'YOUR_24_CHAR_ID')`
        );
      }
      if (storeSlug) {
        config.headers['X-Store-Slug'] = storeSlug;
      }
    }
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
