import axios, { AxiosInstance } from 'axios';
import toast from 'react-hot-toast';
import { store } from '../store';
import { getHostTenant } from './activeTenant';
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
  // Priority, most specific first:
  //   1. Path storefront (/s/:slug) — the route the user is literally on.
  //   2. Host tenant — this deployment's own domain maps to a store. Resolved
  //      once at boot by SiteProvider and held in memory, never in storage.
  //   3. Admin-selected store — a merchant working in /admin on the platform
  //      host, where the store comes from the switcher rather than the URL.
  //
  // `VITE_STORE_ID` used to sit at the bottom of this list, which meant that on
  // the platform's own domain EVERY request resolved to one hardcoded tenant.
  // It is gone: a store is now reachable only by a route or a host that
  // genuinely belongs to it. The dev-only override lives in SiteContext, where
  // it is gated on a development build and cannot leak into production.
  //
  // Host outranks the admin selection deliberately: a shopper on
  // shop.acme.com must see Acme even if that browser once administered another
  // store and left `currentStoreId` behind.

  const pathStorefrontSlug = sessionStorage.getItem('sf_active_slug');
  const hostTenant = getHostTenant();

  const isValidObjectId = (id: string | undefined | null): boolean =>
    typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);

  if (pathStorefrontSlug) {
    config.headers['X-Store-Slug'] = pathStorefrontSlug;
  } else if (hostTenant) {
    config.headers['X-Store-ID'] = hostTenant.storeId;
  } else {
    const currentStoreId = localStorage.getItem('currentStoreId');

    if (isValidObjectId(currentStoreId)) {
      config.headers['X-Store-ID'] = currentStoreId as string;
    } else if (currentStoreId) {
      // Present but malformed — warn loudly so typos surface immediately rather
      // than as a wall of 404s from every tenant route.
      console.error(
        `[axios] ⚠️ currentStoreId in localStorage is NOT a valid 24-char ObjectId ` +
        `(got "${currentStoreId}", length ${currentStoreId.length}). ` +
        `All tenant API calls will 404 until a valid ID is set.`
      );
    }
    // Otherwise send no store header at all. On the platform host that is
    // correct: platform routes (/auth, /onboarding, /plans, /stores) are not
    // tenant-scoped, and guessing a tenant here is exactly the old bug.
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

/**
 * Attaches silent-refresh-on-401 to an axios instance.
 *
 * Exported because the storefront runs on a SEPARATE axios instance — `sfApi`,
 * created per tenant with the `X-Store-Slug` header baked in (see
 * StorefrontContext). That instance only ever had a request interceptor, so
 * every authenticated storefront call — add to cart, update/remove item,
 * checkout, orders — silently 401'd once the 15-minute access token expired:
 * no refresh, no re-login prompt, the shopper clicked "Add to cart" and nothing
 * happened. Sharing this fixes all of them.
 *
 * The retry replays on the ORIGINATING `instance`, not a hardcoded one, so a
 * refreshed storefront request keeps its `X-Store-Slug` rather than being sent
 * tenant-less. The refresh state (`isRefreshing`/`failedQueue`) is module-level,
 * so a burst of 401s across both instances triggers ONE refresh and the rest
 * queue behind it.
 */
export function attachAuthRefresh(instance: AxiosInstance) {
  instance.interceptors.response.use(
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
          // Another refresh is already in flight — queue this request, then
          // replay it on THIS instance so its tenant header survives.
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          }).then((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return instance(original);
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
          // Backend rotates the refresh cookie server-side — we only handle the
          // new access token. setTokens persists it to localStorage too, so
          // sfApi's request interceptor (which reads localStorage) picks it up.
          store.dispatch(setTokens({ accessToken }));
          processQueue(null, accessToken);
          original.headers.Authorization = `Bearer ${accessToken}`;
          return instance(original);
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
}

attachAuthRefresh(api);

export default api;
