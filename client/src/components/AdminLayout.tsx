import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { logout } from '../store/authSlice';
import { setTokens } from '../store/authSlice';
import { clearCart } from '../store/cartSlice';
import { removeCoupon } from '../store/couponSlice';
import { fetchCurrentStore, fetchMyStores, setCurrentStore } from '../store/storeSlice';
import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api/admin';
import { Store } from '../types';
import { AnimatePresence, motion } from 'framer-motion';
import TrialBanner from './TrialBanner';
import TrialExpiredWall from './TrialExpiredWall';
import { useTrialStatus } from '../hooks/useTrialStatus';

const NAV_LINKS = [
  { to: '/admin', label: '📊 Dashboard', end: true },
  { to: '/admin/products', label: '📦 Products' },
  { to: '/admin/categories', label: '🗂️ Categories' },
  { to: '/admin/orders', label: '🛒 Orders' },
  { to: '/admin/users', label: '👥 Users' },
  { to: '/admin/newsletter', label: '📧 Newsletter' },
  { to: '/admin/coupons', label: '🏷️ Coupons' },
  { to: '/admin/pricing', label: '💎 Plans & Pricing' },
  { to: '/admin/settings', label: '⚙️ Settings' },
];

// ── Store avatar (logo or initials) ──────────────────────────────────────────

function StoreAvatar({ store, size = 'md' }: { store: Store; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = { sm: 'w-6 h-6 text-xs', md: 'w-8 h-8 text-sm', lg: 'w-10 h-10 text-base' };
  const initials = store.name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  const colors = [
    'bg-indigo-500', 'bg-violet-500', 'bg-emerald-500', 'bg-rose-500',
    'bg-amber-500', 'bg-cyan-500', 'bg-pink-500', 'bg-teal-500',
  ];
  const colorIndex = store.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  const bgColor = colors[colorIndex];

  if (store.settings?.logoUrl) {
    return (
      <img
        src={store.settings.logoUrl}
        alt={store.name}
        className={`${sizeClasses[size]} rounded-lg object-contain bg-white shrink-0`}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <div className={`${sizeClasses[size]} ${bgColor} rounded-lg flex items-center justify-center text-white font-bold shrink-0`}>
      {initials || '?'}
    </div>
  );
}

// ── Store Switcher dropdown ───────────────────────────────────────────────────

function StoreSwitcher() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const currentStore = useAppSelector(s => s.currentStore.current);
  const myStores = useAppSelector(s => s.currentStore.myStores);
  const myStoresLoading = useAppSelector(s => s.currentStore.myStoresLoading);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSwitch = async (store: Store) => {
    if (store._id === currentStore?._id) { setOpen(false); return; }

    try {
      // Get a fresh JWT scoped to the target store BEFORE switching.
      const token = localStorage.getItem('accessToken') ?? '';
      const res = await fetch(`/api/v1/stores/${store._id}/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      const newToken: string = json?.data?.accessToken ?? token;

      // Update BOTH localStorage keys atomically before any re-render
      localStorage.setItem('accessToken', newToken);
      localStorage.setItem('currentStoreId', store._id);
      localStorage.setItem('currentStore', JSON.stringify(store)); // ← critical: sync the full store object
      dispatch(setTokens({ accessToken: newToken, refreshToken: localStorage.getItem('refreshToken') ?? '' }));
    } catch {
      // Fallback: update both keys even if token swap fails
      localStorage.setItem('currentStoreId', store._id);
      localStorage.setItem('currentStore', JSON.stringify(store));
    }

    dispatch(clearCart());
    dispatch(removeCoupon());
    dispatch(setCurrentStore(store));
    dispatch(fetchCurrentStore());
    setOpen(false);

    navigate('/admin');
    setTimeout(() => window.location.reload(), 50);
  };

  // ── Trigger: always rendered, shows placeholder when no store ────────────
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors"
        title="Switch store"
      >
        {currentStore ? (
          <>
            <StoreAvatar store={currentStore} size="md" />
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-white truncate leading-tight">{currentStore.name}</p>
              <p className="text-xs text-gray-400 truncate leading-tight capitalize">{currentStore.subscriptionPlan}</p>
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 rounded-lg bg-gray-700 border-2 border-dashed border-gray-500 flex items-center justify-center shrink-0">
              <span className="text-gray-400 text-sm">🏪</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-sm font-semibold text-gray-300 truncate leading-tight">Select a Store</p>
              <p className="text-xs text-gray-500 truncate leading-tight">No store active</p>
            </div>
          </>
        )}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-1.5 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="px-3 py-2 border-b border-gray-700">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Your Stores</p>
            </div>

            <div className="max-h-64 overflow-y-auto py-1">
              {myStoresLoading ? (
                <div className="px-3 py-4 flex items-center justify-center">
                  <span className="w-4 h-4 border-2 border-gray-600 border-t-gray-300 rounded-full animate-spin" />
                </div>
              ) : myStores.length === 0 ? (
                /* ── Empty state — always shows CTA ── */
                <div className="px-4 py-5 text-center">
                  <p className="text-2xl mb-2">🏪</p>
                  <p className="text-sm font-medium text-gray-300 mb-1">No stores yet</p>
                  <p className="text-xs text-gray-500">Create your first store to get started.</p>
                </div>
              ) : (
                myStores.map(store => {
                  const isActive = store._id === currentStore?._id;
                  return (
                    <button
                      key={store._id}
                      onClick={() => handleSwitch(store)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-primary-600/20 text-white' : 'text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <StoreAvatar store={store} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate leading-tight">{store.name}</p>
                        <p className="text-xs text-gray-500 truncate leading-tight capitalize">
                          {store.subscriptionStatus === 'active' ? '🟢' : '🟡'} {store.subscriptionPlan}
                        </p>
                      </div>
                      {isActive && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-primary-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer CTA — primary style when no stores, subtle otherwise */}
            <div className="border-t border-gray-700 p-1.5">
              <a
                href="/admin/stores/new"
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  myStores.length === 0
                    ? 'bg-primary-600 hover:bg-primary-500 text-white'
                    : 'text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <span className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold ${
                  myStores.length === 0 ? 'bg-primary-500' : 'bg-gray-700'
                }`}>+</span>
                <span>{myStores.length === 0 ? 'Create your first store' : 'Create new store'}</span>
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main layout ───────────────────────────────────────────────────────────────

export default function AdminLayout() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [lowStockCount, setLowStockCount] = useState(0);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  const currentStore = useAppSelector(s => s.currentStore.current);
  const storeLoading = useAppSelector(s => s.currentStore.loading);

  // Track the last storeId we fetched for — prevents duplicate calls
  const lastFetchedStoreId = useRef<string | null>(null);

  // Kick off store fetch on mount if not already hydrated
  useEffect(() => {
    if (!currentStore) {
      dispatch(fetchCurrentStore());
    }
  }, [dispatch]); // eslint-disable-line

  // Timeout guard — if store hasn't loaded in 4s, stop spinning
  useEffect(() => {
    if (currentStore?._id) return; // already loaded
    const t = setTimeout(() => setLoadingTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [currentStore?._id]);

  useEffect(() => {
    const storeId = currentStore?._id;
    if (!storeId || storeId === lastFetchedStoreId.current) return;
    lastFetchedStoreId.current = storeId;
    adminApi.getLowStock(10, storeId)
      .then(res => setLowStockCount(res.data.data.count))
      .catch(() => {});
    dispatch(fetchMyStores());
  }, [dispatch, currentStore?._id]);

  const handleLogout = () => {
    dispatch(logout());
    navigate('/login');
  };

  const { isExpired } = useTrialStatus();
  const location = useLocation();

  // Allow pricing page even when trial is expired so users can upgrade
  const isPricingPage = location.pathname === '/admin/pricing';

  // ── Store loading gate ────────────────────────────────────────────────────
  // Block all child pages from rendering until we have a valid store context.
  if (!currentStore?._id) {
    // Timed out — show actionable error instead of infinite spinner
    if (loadingTimedOut) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-950">
          <div className="text-center space-y-4 max-w-sm px-6">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-white font-semibold text-lg">Could not load store</h2>
            <p className="text-gray-400 text-sm">
              Your session may have expired or the store is unavailable.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => { dispatch(fetchCurrentStore()); setLoadingTimedOut(false); }}
                className="btn-primary text-sm px-4 py-2"
              >
                Retry
              </button>
              <button
                onClick={() => { dispatch(logout()); navigate('/login'); }}
                className="btn-secondary text-sm px-4 py-2"
              >
                Log out
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex h-screen overflow-hidden">
        <aside className="w-60 bg-gray-900 text-white shrink-0 flex flex-col h-screen sticky top-0">
          <div className="p-3 border-b border-gray-700/60 shrink-0">
            <div className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-800 animate-pulse">
              <div className="w-8 h-8 rounded-lg bg-gray-700 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 bg-gray-700 rounded w-3/4" />
                <div className="h-2.5 bg-gray-700 rounded w-1/2" />
              </div>
            </div>
          </div>
          <div className="p-3 space-y-1 flex-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-8 bg-gray-800 rounded-lg animate-pulse" />
            ))}
          </div>
        </aside>
        <main className="flex-1 bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading store…</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar — fixed height, never scrolls with content */}
      <aside className="w-60 bg-gray-900 text-white shrink-0 flex flex-col h-screen sticky top-0">

        {/* Store switcher — always visible at top */}
        <div className="p-3 border-b border-gray-700/60 shrink-0">
          <StoreSwitcher />
          {lowStockCount > 0 && (
            <p className="text-xs text-orange-400 mt-2 flex items-center gap-1 px-1">
              <span>⚠️</span> {lowStockCount} low stock item{lowStockCount !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Navigation — scrollable if links overflow, grows to fill space */}
        <nav className="p-3 space-y-0.5 flex-1 overflow-y-auto">
          {NAV_LINKS.map(l => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-primary-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                }`
              }
            >
              <span>{l.label}</span>
              {l.to === '/admin/products' && lowStockCount > 0 && (
                <span className="bg-orange-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {lowStockCount > 99 ? '99+' : lowStockCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer — always pinned to bottom */}
        <div className="p-3 border-t border-gray-700/60 space-y-1 shrink-0">
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-sm text-emerald-400 hover:bg-emerald-600 hover:text-white transition-colors group"
          >
            <span className="flex items-center gap-2">
              <span>👁️</span>
              <span>View Store</span>
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 opacity-50 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded-lg text-sm text-gray-300 hover:bg-red-600 hover:text-white transition-colors text-left"
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      {/* Main content — scrolls independently, remounts on store switch */}
      <main className="flex-1 bg-gray-50 dark:bg-gray-950 overflow-y-auto flex flex-col">
        <TrialBanner />
        {isExpired && !isPricingPage ? (
          <TrialExpiredWall />
        ) : (
          <div className="flex-1 overflow-y-auto">
            <Outlet key={currentStore._id} />
          </div>
        )}
      </main>
    </div>
  );
}
