/**
 * StorefrontLayout
 *
 * Wrapper for all /s/:slug routes. Responsibilities:
 *  1. Resolve the Store from the slug using GET /api/v1/stores/by-slug/:slug
 *  2. Render a loading state while fetching
 *  3. Render a 404 when the store doesn't exist or is inactive
 *  4. Provide StorefrontContext to all child routes
 *  5. Render a store-branded top navbar
 *
 * This component intentionally does NOT touch localStorage, Redux storeSlice,
 * or the admin session — it is a completely separate context.
 */

import { useEffect, useState } from 'react';
import { Outlet, Link, useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { motion } from 'framer-motion';
import { Store } from '../types';
import { StorefrontProvider } from '../contexts/StorefrontContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import { useDarkMode } from '../hooks/useDarkMode';
import { useAppSelector } from '../hooks/useAppDispatch';

// ── Storefront Navbar ─────────────────────────────────────────────────────────

function StorefrontNavbar({ store, slug }: { store: Store; slug: string }) {
  const { dark, toggle } = useDarkMode();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const base = `/s/${slug}`;

  return (
    <nav className="bg-white/98 dark:bg-stone-900/98 backdrop-blur-md border-b border-amber-200 dark:border-amber-900/50 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Store branding — gold accent */}
          <Link to={base} className="flex items-center gap-2.5 text-xl font-bold text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors">
            {store.settings?.logoUrl ? (
              <img
                src={store.settings.logoUrl}
                alt={store.name}
                className="w-8 h-8 rounded-lg object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : null}
            <span>{store.name}</span>
          </Link>

          <div className="flex items-center gap-4">
            <Link to={base} className="text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
              Shop
            </Link>

            {isAuthenticated ? (
              <>
                <Link to={`${base}/cart`} className="text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Cart
                </Link>
                <Link to={`${base}/orders`} className="text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  Orders
                </Link>
              </>
            ) : (
              <>
                <Link
                  to={`/login?redirect=/s/${slug}`}
                  className="text-sm font-medium text-stone-600 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  Login
                </Link>
                {/* Platform branding is hidden on plans that include
                    removeBranding — the flag was declared in PLAN_LIMITS but
                    never enforced, so paying customers still advertised us. */}
                {!store.planCapabilities?.removeBranding && (
                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}>
                    <Link
                      to="/start"
                      className="text-sm font-semibold px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 text-white transition-all inline-block shadow-sm shadow-amber-200 dark:shadow-amber-900/40"
                    >
                      Sell on Vendbase
                    </Link>
                  </motion.div>
                )}
              </>
            )}

            {/* Plan badge — amber/gold accent */}
            {store.subscriptionPlan !== 'free' && (
              <span className="hidden sm:inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-medium capitalize border border-amber-200 dark:border-amber-700/50">
                {store.subscriptionPlan}
              </span>
            )}

            {/* Dark mode toggle */}
            <button
              onClick={toggle}
              aria-label="Toggle dark mode"
              className={`relative w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${dark ? 'bg-amber-600' : 'bg-gray-200'}`}
            >
              <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none select-none">🌙</span>
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs pointer-events-none select-none">☀️</span>
              <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-300 flex items-center justify-center text-sm ${dark ? 'translate-x-7' : 'translate-x-0.5'}`}>
                {dark ? '🌙' : '☀️'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

// ── Storefront Footer ─────────────────────────────────────────────────────────

function StorefrontFooter({ store }: { store: Store }) {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 text-gray-400 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 mb-8">

          {/* Brand + About column */}
          <div>
            <div className="flex items-center gap-2.5 mb-3">
              {store.settings?.logoUrl ? (
                <img src={store.settings.logoUrl} alt={store.name}
                  className="w-8 h-8 rounded-lg object-contain bg-white"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : null}
              <span className="text-white font-bold text-lg">{store.name}</span>
            </div>

            {/* Dynamic store description */}
            {store.settings?.description && (
              <p className="text-sm leading-relaxed text-gray-400 mb-3">
                {store.settings.description}
              </p>
            )}

            {/* Contact info */}
            {store.settings?.contactEmail && (
              <a href={`mailto:${store.settings.contactEmail}`}
                className="text-sm hover:text-white transition-colors block">
                ✉ {store.settings.contactEmail}
              </a>
            )}
            {store.settings?.contactPhone && (
              <a href={`tel:${store.settings.contactPhone}`}
                className="text-sm hover:text-white transition-colors block mt-1">
                📞 {store.settings.contactPhone}
              </a>
            )}

            {/* Social links */}
            {(store.settings?.facebook || store.settings?.instagram || store.settings?.twitter) && (
              <div className="flex gap-3 mt-3">
                {store.settings.instagram && (
                  <a href={store.settings.instagram} target="_blank" rel="noopener noreferrer"
                    className="text-gray-400 hover:text-pink-400 transition-colors text-lg" title="Instagram">
                    📸
                  </a>
                )}
                {store.settings.facebook && (
                  <a href={store.settings.facebook} target="_blank" rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-400 transition-colors text-lg" title="Facebook">
                    👤
                  </a>
                )}
                {store.settings.twitter && (
                  <a href={store.settings.twitter} target="_blank" rel="noopener noreferrer"
                    className="text-gray-400 hover:text-sky-400 transition-colors text-lg" title="Twitter / X">
                    🐦
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-widest mb-3">Shop</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="." relative="path" className="hover:text-white transition-colors">All Products</Link></li>
              <li><Link to="." relative="path" className="hover:text-white transition-colors">New Arrivals</Link></li>
              <li><Link to="." relative="path" className="hover:text-white transition-colors">Deals &amp; Offers</Link></li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h4 className="text-white font-semibold text-sm uppercase tracking-widest mb-3">Support</h4>
            <ul className="space-y-2 text-sm">
              {store.settings?.contactEmail && (
                <li>
                  <a href={`mailto:${store.settings.contactEmail}`}
                    className="hover:text-white transition-colors">Contact Us</a>
                </li>
              )}
              <li><motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} className="inline-block"><Link to="/start" className="hover:text-white transition-colors">Open Your Own Store</Link></motion.div></li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <p>© {year} {store.name}. All rights reserved.</p>
          <p className="flex items-center gap-1">
            Powered by{' '}
            <Link to="/" className="text-primary-400 hover:text-primary-300 font-semibold transition-colors">
              Vendbase
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

// ── Main layout ───────────────────────────────────────────────────────────────

type ResolveState =
  | { status: 'loading' }
  | { status: 'found'; store: Store }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

export default function StorefrontLayout() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<ResolveState>({ status: 'loading' });

  useEffect(() => {
    if (!slug) {
      setState({ status: 'not_found' });
      return;
    }

    setState({ status: 'loading' });

    axios
      .get<{ data: Store }>(`/api/v1/stores/by-slug/${encodeURIComponent(slug)}`)
      .then(res => {
        const store = res.data?.data;
        if (!store?._id) {
          setState({ status: 'not_found' });
        } else if (!store.isActive) {
          setState({ status: 'error', message: 'This store is currently unavailable.' });
        } else {
          setState({ status: 'found', store });
        }
      })
      .catch(err => {
        const status = err?.response?.status;
        if (status === 404) {
          setState({ status: 'not_found' });
        } else {
          setState({ status: 'error', message: 'Could not load store. Please try again.' });
        }
      });
  }, [slug]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white dark:from-stone-900 dark:to-gray-950 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-amber-600 dark:text-amber-400">Loading store…</p>
        </div>
      </div>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (state.status === 'not_found') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white dark:from-stone-900 dark:to-gray-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-6xl">🏪</div>
          <h1 className="text-2xl font-bold text-stone-900 dark:text-white">Store not found</h1>
          <p className="text-stone-500 dark:text-stone-400">
            The store <strong className="font-mono text-amber-700 dark:text-amber-400">/{slug}</strong> doesn't exist or has been removed.
          </p>
          <div className="flex gap-3 justify-center">
            <Link to="/" className="btn-primary px-6">Go to ShopHub</Link>
            <Link to="/start" className="btn-secondary px-6">Start a store</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white dark:from-stone-900 dark:to-gray-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-bold text-stone-900 dark:text-white">Something went wrong</h1>
          <p className="text-stone-500 dark:text-stone-400">{state.message}</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => setState({ status: 'loading' })} className="btn-primary px-6">
              Retry
            </button>
            <Link to="/" className="btn-secondary px-6">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Found ──────────────────────────────────────────────────────────────────
  const { store } = state;

  return (
    // `key={slug}` forces a full remount when the shopper moves between two
    // storefronts in-SPA. Without it React Router reuses this subtree across
    // param changes, and any state seeded from the old slug — the scoped axios
    // instance, cached queries, in-flight requests — leaks into the new tenant.
    <StorefrontProvider key={slug} store={store} slug={slug!}>
      {/* Applies the merchant's chosen presentation theme to this storefront.
          Wraps only the layout, so nothing outside /s/:slug is affected, and it
          renders no DOM of its own — the tree below is unchanged. */}
      <ThemeProvider theme={store.theme}>
        <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white dark:from-stone-900 dark:to-gray-950 flex flex-col">
          <StorefrontNavbar store={store} slug={slug!} />
          <main className="flex-1">
            <Outlet />
          </main>
          <StorefrontFooter store={store} />
        </div>
      </ThemeProvider>
    </StorefrontProvider>
  );
}
