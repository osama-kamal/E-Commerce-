import { lazy, Suspense, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'react-redux';
import { Toaster } from 'react-hot-toast';
import { store } from './store';
import { setWishlist } from './store/wishlistSlice';
import { clearCart } from './store/cartSlice';
import { removeCoupon } from './store/couponSlice';
import { fetchCurrentStore } from './store/storeSlice';
import { wishlistApi } from './api/wishlist';
import { useNotifications } from './hooks/useNotifications';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';
import BackToTop from './components/BackToTop';
import ComparisonBar from './components/ComparisonBar';

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
const AdminNewStore     = lazy(() => import('./pages/admin/AdminNewStore'));
const AdminPricing      = lazy(() => import('./pages/admin/AdminPricing'));
const StartStorePage    = lazy(() => import('./pages/StartStorePage'));

// Minimal fallback shown while a chunk is loading
function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-primary-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  useNotifications(); // Initialize notifications system

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
    if (token) {
      wishlistApi.get()
        .then(res => store.dispatch(setWishlist(res.data.data.products)))
        .catch(() => { /* not logged in yet */ });
    }
  }, []);

  return (
    <>
      <Navbar />
      <main>
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </main>
      <ComparisonBar />
      <Suspense fallback={null}>
        <Chatbot />
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { borderRadius: '10px', fontSize: '14px' },
          }}
        />
        <BackToTop />

        <Routes>
          {/* Public */}
          <Route path="/"           element={<Layout><HomePage /></Layout>} />
          <Route path="/login"      element={<Suspense fallback={<PageLoader />}><LoginPage /></Suspense>} />
          <Route path="/register"   element={<Suspense fallback={<PageLoader />}><RegisterPage /></Suspense>} />
          <Route path="/start"      element={<Suspense fallback={<PageLoader />}><StartStorePage /></Suspense>} />
          <Route path="/forgot-password" element={<Suspense fallback={<PageLoader />}><ForgotPasswordPage /></Suspense>} />
          <Route path="/reset-password"  element={<Suspense fallback={<PageLoader />}><ResetPasswordPage /></Suspense>} />
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

          {/* Admin protected */}
          <Route element={<ProtectedRoute requiredRole="admin" />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index        element={<Suspense fallback={<PageLoader />}><AdminDashboard /></Suspense>} />
              <Route path="products" element={<Suspense fallback={<PageLoader />}><AdminProducts /></Suspense>} />
              <Route path="categories" element={<Suspense fallback={<PageLoader />}><AdminCategories /></Suspense>} />
              <Route path="orders"   element={<Suspense fallback={<PageLoader />}><AdminOrders /></Suspense>} />
              <Route path="users"    element={<Suspense fallback={<PageLoader />}><AdminUsers /></Suspense>} />
              <Route path="newsletter" element={<Suspense fallback={<PageLoader />}><AdminNewsletter /></Suspense>} />
              <Route path="coupons"    element={<Suspense fallback={<PageLoader />}><AdminCoupons /></Suspense>} />
              <Route path="settings"   element={<Suspense fallback={<PageLoader />}><AdminSettings /></Suspense>} />
              <Route path="pricing"    element={<Suspense fallback={<PageLoader />}><AdminPricing /></Suspense>} />
              <Route path="stores/new" element={<Suspense fallback={<PageLoader />}><AdminNewStore /></Suspense>} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </Provider>
  );
}
