import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Provider } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { store } from './store';
import { setWishlist } from './store/wishlistSlice';
import { clearCart } from './store/cartSlice';
import { removeCoupon } from './store/couponSlice';
import { fetchCurrentStore } from './store/storeSlice';
import { wishlistApi } from './api/wishlist';
import { useAppSelector } from './hooks/useAppDispatch';
import { ThemeProvider } from './theme/ThemeProvider';
import { SiteProvider, useSite } from './contexts/SiteContext';
import { useNotifications } from './hooks/useNotifications';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';
import StorefrontLayout from './components/StorefrontLayout';
import BackToTop from './components/BackToTop';
import ComparisonBar from './components/ComparisonBar';
import Footer from './components/Footer';

// Chatbot is heavy (chat UI + API wiring) — load only after first interaction
const Chatbot = lazy(() => import('./components/Chatbot'));

// Route-level code splitting — each page loads only when navigated to
const HomePage          = lazy(() => import('./pages/HomePage'));
const LoginPage         = lazy(() => import('./pages/LoginPage'));
const RegisterPage      = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage  = lazy(() => import('./pages/ForgotPasswordPage'));
const ResetPasswordPage   = lazy(() => import('./pages/ResetPasswordPage'));
const ProductDetailPage = lazy(() => import('./pages/ProductDetailPage'));
const CartPage          = lazy(() => import('./pages/CartPage'));
const CheckoutPage      = lazy(() => import('./pages/CheckoutPage'));
const WishlistPage      = lazy(() => import('./pages/WishlistPage'));
const OrdersPage        = lazy(() => import('./pages/OrdersPage'));
const OrderDetailPage   = lazy(() => import('./pages/OrderDetailPage'));
const ProfilePage       = lazy(() => import('./pages/ProfilePage'));
const ComparePage       = lazy(() => import('./pages/ComparePage'));
const AdminDashboard    = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminProducts     = lazy(() => import('./pages/admin/AdminProducts'));
const AdminOrders       = lazy(() => import('./pages/admin/AdminOrders'));
const AdminUsers        = lazy(() => import('./pages/admin/AdminUsers'));
const AdminNewsletter   = lazy(() => import('./pages/admin/AdminNewsletter'));
const AdminCoupons      = lazy(() => import('./pages/admin/AdminCoupons'));
const AdminCategories   = lazy(() => import('./pages/admin/AdminCategories'));
const AdminSettings     = lazy(() => import('./pages/admin/AdminSettings'));
const AdminShipping     = lazy(() => import('./pages/admin/AdminShipping'));
const AdminTax          = lazy(() => import('./pages/admin/AdminTax'));
const AdminNewStore     = lazy(() => import('./pages/admin/AdminNewStore'));
const AdminPricing      = lazy(() => import('./pages/admin/AdminPricing'));
const AdminPlanEditor   = lazy(() => import('./pages/admin/AdminPlanEditor'));
const PlatformStores    = lazy(() => import('./pages/admin/PlatformStores'));
const StartStorePage    = lazy(() => import('./pages/StartStorePage'));
const PlatformHomePage  = lazy(() => import('./pages/PlatformHomePage'));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'));
const PrivacyPolicyPage  = lazy(() => import('./pages/PrivacyPolicyPage'));

// Storefront pages — public tenant storefronts at /s/:slug
const StorefrontHomePage    = lazy(() => import('./pages/storefront/StorefrontHomePage'));
const StorefrontProductPage = lazy(() => import('./pages/storefront/StorefrontProductPage'));
const StorefrontCartPage    = lazy(() => import('./pages/storefront/StorefrontCartPage'));
const StorefrontOrdersPage  = lazy(() => import('./pages/storefront/StorefrontOrdersPage'));

// Minimal fallback shown while a chunk is loading
function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ── Platform admin route guard ────────────────────────────────────────────────
// Allows access only when the JWT carries role: 'super-admin'.
// Regular store admins (role: 'admin') are redirected to their own dashboard.

function getJwtRole(): string | undefined {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) return undefined;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload?.role === 'string' ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

function PlatformAdminRoute({ children }: { children: React.ReactNode }) {
  const isSuperAdmin = getJwtRole() === 'super-admin';
  if (!isSuperAdmin) {
    // Silently redirect to the regular store dashboard — no error, no data leak
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

/**
 * Holds routing until the host's tenant is known.
 *
 * Every tenant-scoped request depends on this answer — the axios interceptor
 * reads it, `fetchCurrentStore` reads it, and `useTenant()` reads it. Rendering
 * routes first and correcting afterwards is exactly the race that made a
 * storefront's opening fetch resolve to the wrong store; gating once here means
 * no component has to defend against it individually.
 *
 * Costs one round-trip before first paint. That is the honest price of not
 * knowing which shop this is until we ask.
 */
function SiteGate({ children }: { children: React.ReactNode }) {
  const { mode } = useSite();
  if (mode === 'loading') return <PageLoader />;
  return <>{children}</>;
}

/**
 * What `/` renders, decided by the host.
 *
 * Storefront host → that merchant's shop, using the SAME rich components the
 * main site already had (filters, hero, the full checkout). Reusing them keeps
 * one good storefront rather than growing a second thinner one.
 *
 * Platform host → the platform's landing page.
 *
 * Blocks on resolution rather than guessing. Rendering a storefront optimistically
 * and correcting it would flash another merchant's catalogue at the visitor.
 */
function RootRoute() {
  const { mode } = useSite();

  if (mode === 'loading') return <PageLoader />;

  if (mode === 'storefront') {
    return <Layout><HomePage /></Layout>;
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <PlatformHomePage />
      </Suspense>
    </Layout>
  );
}

/**
 * Keeps the merchant dashboard on the platform host.
 *
 * On a tenant domain the tenant is pinned by the host, which would fight the
 * admin store switcher — a merchant with two shops could open /admin on one
 * domain and silently edit the other. Sending them to the shop instead is the
 * unambiguous behaviour.
 */
function AdminOnPlatform({ children }: { children: React.ReactNode }) {
  const { mode } = useSite();

  if (mode === 'loading') return <PageLoader />;
  if (mode === 'storefront') return <Navigate to="/" replace />;

  return <>{children}</>;
}

function Layout({ children }: { children: React.ReactNode }) {
  useNotifications(); // Initialize notifications system

  // Storefront theme for the main site.
  //
  // ThemeProvider was originally mounted only inside StorefrontLayout, which
  // serves /s/:slug. Every main-site route — home, product detail, cart,
  // checkout, wishlist — renders through THIS layout, so the theme attribute
  // was never written there and no theme CSS could match. The API and Redux
  // were correct the whole time; nothing was consuming the value.
  //
  // Read from Redux (not fetched here) so switching a theme in Settings updates
  // the storefront immediately: AdminSettings dispatches setCurrentStore, this
  // re-renders, the attribute changes. `fetchCurrentStore()` below repopulates
  // it on a hard refresh, which is what makes the choice survive reload.
  const storeTheme = useAppSelector(s => s.currentStore.current?.theme);

  // Store-change guard: if currentStoreId changes between page loads,
  // clear the Redux cart so stale items from the old store don't persist.
  const prevStoreId = useRef(localStorage.getItem('currentStoreId'));
  useEffect(() => {
    const currentStoreId = localStorage.getItem('currentStoreId');
    if (prevStoreId.current && currentStoreId && prevStoreId.current !== currentStoreId) {
      store.dispatch(clearCart());
      store.dispatch(removeCoupon());
    }
    prevStoreId.current = currentStoreId;
  }, []);

  // Fetch store branding on mount
  useEffect(() => {
    store.dispatch(fetchCurrentStore());
  }, []);
  
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return;

    // Defer the wishlist fetch until after the browser has finished painting
    // the initial frame. This removes the API round-trip from the critical
    // path, reducing Total Blocking Time measured by Lighthouse.
    // requestIdleCallback is used when available (Chrome/Edge); setTimeout(200)
    // is the fallback for Safari and Firefox.
    let handle: number;
    if (typeof requestIdleCallback !== 'undefined') {
      handle = requestIdleCallback(() => {
        wishlistApi.get()
          .then(res => store.dispatch(setWishlist(res.data.data.products)))
          .catch(() => { /* not logged in yet */ });
      });
      return () => cancelIdleCallback(handle);
    } else {
      handle = window.setTimeout(() => {
        wishlistApi.get()
          .then(res => store.dispatch(setWishlist(res.data.data.products)))
          .catch(() => { /* not logged in yet */ });
      }, 200);
      return () => clearTimeout(handle);
    }
  }, []);

  return (
    <ThemeProvider theme={storeTheme}>
      {/* Skip link — first thing in the tab order. Without it a keyboard user
          had to tab through the whole navbar and the entire filter sidebar on
          every page before reaching the product grid. Visually hidden until
          focused, then it appears as a real button. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                   focus:rounded-lg focus:bg-gray-900 focus:px-4 focus:py-2.5 focus:text-sm
                   focus:font-semibold focus:text-white focus:shadow-float
                   dark:focus:bg-white dark:focus:text-gray-900"
      >
        Skip to content
      </a>
      <Navbar />
      {/* tabIndex={-1} so the skip link can move focus here, not just scroll. */}
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </main>
      <Footer />
      <ComparisonBar />
      <Suspense fallback={null}>
        <Chatbot />
      </Suspense>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      {/* Resolves platform-vs-storefront from the hostname once, above the
          router, so every route can ask `useSite()` and no route renders
          against an unresolved tenant. */}
      <SiteProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { borderRadius: '10px', fontSize: '14px' },
          }}
        />
        <SiteGate>
        <Routes>
          {/* Root — the one route whose meaning depends on the HOST.
              On a tenant domain it is that merchant's shop; on the platform's
              own domain it is the platform. This used to be unconditionally a
              storefront bound to one hardcoded store, which made the platform
              and a tenant the same page. */}
          <Route path="/" element={<RootRoute />} />

          {/* Public */}
          <Route path="/login"      element={<Suspense fallback={<PageLoader />}><LoginPage /></Suspense>} />
          <Route path="/register"   element={<Suspense fallback={<PageLoader />}><RegisterPage /></Suspense>} />
          <Route path="/start"      element={<Suspense fallback={<PageLoader />}><StartStorePage /></Suspense>} />
          <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPasswordPage /></Suspense>} />
          <Route path="/reset-password"  element={<Suspense fallback={<PageLoader />}><ResetPasswordPage /></Suspense>} />
          <Route path="/terms"           element={<Layout><TermsOfServicePage /></Layout>} />
          <Route path="/privacy"         element={<Layout><PrivacyPolicyPage /></Layout>} />
          <Route path="/products/:id" element={<Layout><ProductDetailPage /></Layout>} />
          <Route path="/compare"    element={<Layout><ComparePage /></Layout>} />

          {/* Customer protected */}
          <Route element={<ProtectedRoute />}>
            <Route path="/cart"        element={<Layout><CartPage /></Layout>} />
            <Route path="/checkout"    element={<Layout><CheckoutPage /></Layout>} />
            <Route path="/wishlist"    element={<Layout><WishlistPage /></Layout>} />
            <Route path="/orders"      element={<Layout><OrdersPage /></Layout>} />
            <Route path="/orders/:id"  element={<Layout><OrderDetailPage /></Layout>} />
            <Route path="/profile"     element={<Layout><ProfilePage /></Layout>} />
          </Route>

          {/* Storefront — public tenant storefronts at /s/:slug */}
          <Route path="/s/:slug" element={<StorefrontLayout />}>
            <Route index element={<Suspense fallback={<PageLoader />}><StorefrontHomePage /></Suspense>} />
            <Route path="products/:id" element={<Suspense fallback={<PageLoader />}><StorefrontProductPage /></Suspense>} />
            <Route path="cart"    element={<Suspense fallback={<PageLoader />}><StorefrontCartPage /></Suspense>} />
            <Route path="orders"  element={<Suspense fallback={<PageLoader />}><StorefrontOrdersPage /></Suspense>} />
            {/* Checkout MUST live inside this tree.
                It previously sat only at the top-level /checkout, so a
                storefront shopper leaving the cart unmounted StorefrontLayout —
                and with it the provider that identifies the tenant. The order
                was then placed against whatever the axios interceptor fell back
                to, which is the platform's own hardcoded store. Nested here,
                the provider stays mounted and `useTenant()` keeps resolving the
                merchant the shopper is actually buying from. */}
            <Route path="checkout" element={<Suspense fallback={<PageLoader />}><CheckoutPage /></Suspense>} />
            <Route path="orders/:id" element={<Suspense fallback={<PageLoader />}><OrderDetailPage /></Suspense>} />
          </Route>

          {/* Admin protected.
              Registered on every host, but AdminLayout is only reachable on the
              platform: `AdminOnPlatform` below bounces a tenant domain back to
              its shop. Merchants administer from the platform host, the way
              admin.shopify.com is separate from the shop's own domain — mixing
              them would put the store switcher in conflict with the host. */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/admin" element={<AdminOnPlatform><AdminLayout /></AdminOnPlatform>}>
              <Route index        element={<Suspense fallback={<PageLoader />}><AdminDashboard /></Suspense>} />
              <Route path="products" element={<Suspense fallback={<PageLoader />}><AdminProducts /></Suspense>} />
              <Route path="categories" element={<Suspense fallback={<PageLoader />}><AdminCategories /></Suspense>} />
              <Route path="orders"   element={<Suspense fallback={<PageLoader />}><AdminOrders /></Suspense>} />
              <Route path="users"    element={<Suspense fallback={<PageLoader />}><AdminUsers /></Suspense>} />
              <Route path="newsletter" element={<Suspense fallback={<PageLoader />}><AdminNewsletter /></Suspense>} />
              <Route path="coupons"    element={<Suspense fallback={<PageLoader />}><AdminCoupons /></Suspense>} />
              <Route path="settings"   element={<Suspense fallback={<PageLoader />}><AdminSettings /></Suspense>} />
              <Route path="shipping"   element={<Suspense fallback={<PageLoader />}><AdminShipping /></Suspense>} />
              <Route path="tax"        element={<Suspense fallback={<PageLoader />}><AdminTax /></Suspense>} />
              <Route path="pricing"    element={<Suspense fallback={<PageLoader />}><AdminPricing /></Suspense>} />
              <Route
                path="plan-editor"
                element={
                  <PlatformAdminRoute>
                    <Suspense fallback={<PageLoader />}><AdminPlanEditor /></Suspense>
                  </PlatformAdminRoute>
                }
              />
              <Route
                path="stores"
                element={
                  <PlatformAdminRoute>
                    <Suspense fallback={<PageLoader />}><PlatformStores /></Suspense>
                  </PlatformAdminRoute>
                }
              />
              <Route path="stores/new" element={<Suspense fallback={<PageLoader />}><AdminNewStore /></Suspense>} />
            </Route>
          </Route>
        </Routes>
        </SiteGate>

        {/* Rendered after <Routes> purely for tab order. It is position:fixed so
            DOM position has no visual effect, but sitting before the routes made
            "Back to top" the very first tab stop on every page — ahead of the
            skip link, which must come first to be useful. */}
        <BackToTop />
      </BrowserRouter>
      </SiteProvider>
    </Provider>
  );
}
