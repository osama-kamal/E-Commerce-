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
import { AlertTriangle, Mail, Moon, Phone, ShoppingCart, Store as StoreIcon, Sun } from 'lucide-react';
import { Store } from '../types';
import { StorefrontProvider } from '../contexts/StorefrontContext';
import { ThemeProvider } from '../theme/ThemeProvider';
import { useDarkMode } from '../hooks/useDarkMode';
import { useAppSelector } from '../hooks/useAppDispatch';
import { useCart } from '../hooks/useCart';

/**
 * Shared shell for the pre-store states (loading / not found / error).
 *
 * Paints NO background of its own — see the note on the main layout below.
 */
function StorefrontShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-sm">{children}</div>
    </div>
  );
}

// ── Cart link ─────────────────────────────────────────────────────────────────

/**
 * Cart link with a live item count.
 *
 * ── Why this is its own component ─────────────────────────────────────────────
 * The storefront navbar had a plain text "Cart" link and no counter at all, so
 * adding a product gave no feedback anywhere in the chrome — the only way to
 * learn the cart had changed was to open it. The main-site Navbar has had a
 * badge all along; the storefront simply never got one.
 *
 * Calling `useCart()` here is the other half of the fix. Nothing on a storefront
 * route fetched the cart, so Redux held nothing until the shopper visited the
 * cart page — a badge alone would have read 0 on every fresh load. React Query
 * dedupes this against the cart page's own query (same tenant-scoped key, 2min
 * staleTime), so mounting it in the navbar costs no extra request.
 *
 * Split out rather than inlined because the query must not run for a signed-out
 * visitor — `/cart` is authenticated and would 401 on every storefront page.
 * Hooks cannot be called conditionally, so the condition lives on the component.
 */
function CartLink({ to, className }: { to: string; className: string }) {
  useCart();

  const count = useAppSelector(
    s => s.cart.cart?.items.reduce((sum, i) => sum + i.quantity, 0) ?? 0
  );

  return (
    <Link
      to={to}
      className={`${className} relative inline-flex items-center gap-2`}
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
    >
      <ShoppingCart className="w-4 h-4" aria-hidden="true" />
      <span className="hidden sm:inline">Cart</span>
      {count > 0 && (
        <span
          className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full
                     bg-gray-900 px-1 text-[10px] font-bold tabular-nums text-white
                     dark:bg-white dark:text-gray-900"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

// ── Storefront Navbar ─────────────────────────────────────────────────────────

function StorefrontNavbar({ store, slug }: { store: Store; slug: string }) {
  const { dark, toggle } = useDarkMode();
  const isAuthenticated = useAppSelector(s => s.auth.isAuthenticated);
  const base = `/s/${slug}`;

  const navLink =
    'text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors ' +
    'dark:text-gray-400 dark:hover:text-white';

  return (
    // A hairline border and a near-opaque white bar, rather than a coloured
    // border plus a drop shadow. Retail chrome should recede — the products are
    // the only thing on the page that should attract the eye.
    <nav className="sticky top-0 z-50 bg-white/85 dark:bg-gray-950/85 backdrop-blur-xl border-b border-gray-200 dark:border-gray-800">
      <div className="storefront-shell">
        <div className="flex items-center justify-between h-16">
          {/* Store identity. Set in the text colour, not an accent — the shop's
              own name is wordmark enough and a coloured brand link competes
              with the "add to cart" affordances further down the page. */}
          <Link
            to={base}
            className="flex items-center gap-2.5 min-w-0 group"
          >
            {store.settings?.logoUrl ? (
              <img
                src={store.settings.logoUrl}
                alt=""
                className="w-8 h-8 rounded-lg object-contain shrink-0"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <span className="w-8 h-8 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 grid place-items-center shrink-0">
                <StoreIcon className="w-4 h-4" aria-hidden="true" />
              </span>
            )}
            <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white truncate group-hover:opacity-70 transition-opacity">
              {store.name}
            </span>
          </Link>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link to={base} className={`${navLink} px-3 py-2`}>Shop</Link>

            {isAuthenticated ? (
              <>
                <CartLink to={`${base}/cart`} className={`${navLink} px-3 py-2`} />
                <Link to={`${base}/orders`} className={`${navLink} px-3 py-2`}>Orders</Link>
              </>
            ) : (
              <>
                <Link to={`/login?redirect=/s/${slug}`} className={`${navLink} px-3 py-2`}>
                  Login
                </Link>
                {/* Platform branding is hidden on plans that include
                    removeBranding — the flag was declared in PLAN_LIMITS but
                    never enforced, so paying customers still advertised us. */}
                {!store.planCapabilities?.removeBranding && (
                  <Link
                    to="/start"
                    className="hidden sm:inline-flex text-sm font-medium px-3.5 py-2 rounded-lg
                               bg-gray-900 text-white hover:bg-gray-800
                               dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200
                               transition-colors"
                  >
                    Sell on Vendbase
                  </Link>
                )}
              </>
            )}

            {/* Kept, restyled neutral. Worth questioning separately: this
                advertises the MERCHANT's billing tier on a page built for
                shoppers, who have no use for it. */}
            {store.subscriptionPlan !== 'free' && (
              <span className="hidden md:inline-flex items-center text-[11px] font-medium capitalize
                               px-2 py-0.5 rounded-md tracking-wide
                               bg-gray-100 text-gray-600 border border-gray-200
                               dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700">
                {store.subscriptionPlan}
              </span>
            )}

            {/* Icon toggle rather than the emoji switch. The old control showed
                a sun AND a moon AND a sliding knob with a third emoji inside it,
                which read as decoration rather than a control. */}
            <button
              onClick={toggle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="ml-1 w-9 h-9 grid place-items-center rounded-lg text-gray-500 hover:text-gray-900
                         hover:bg-gray-100 transition-colors
                         dark:text-gray-400 dark:hover:text-white dark:hover:bg-gray-800"
            >
              {dark
                ? <Sun className="w-[18px] h-[18px]" aria-hidden="true" />
                : <Moon className="w-[18px] h-[18px]" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}

// ── Storefront Footer ─────────────────────────────────────────────────────────

function StorefrontFooter({ store, slug }: { store: Store; slug: string }) {
  const year = new Date().getFullYear();
  const s = store.settings;
  const base = `/s/${slug}`;

  const socials = [
    ['Instagram', s?.instagram],
    ['Facebook', s?.facebook],
    ['Twitter', s?.twitter],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));

  /**
   * Shop links, now real destinations.
   *
   * These were `<Link to="." relative="path">` — "." resolves to the current
   * route, so all three were no-ops that re-rendered the page you were already
   * on. They had nowhere to point: the catalogue kept its filters in component
   * state, so a filtered grid had no URL. StorefrontHomePage now reads its
   * filters from the query string, which gives each of these an address.
   *
   * Absolute (`/s/:slug?…`) rather than relative, so they also work from a
   * product detail page, the cart, or anywhere else the footer renders — the
   * relative form would have resolved against `/s/:slug/products/123`.
   */
  const shopLinks: Array<[string, string]> = [
    ['All Products', base],
    ['New Arrivals', `${base}?sort=newest`],
    ['Deals & Offers', `${base}?sale=true`],
    ['Top Rated', `${base}?sort=rating`],
  ];

  const footLink = 'text-sm text-gray-400 hover:text-white transition-colors';

  return (
    // Dark slab, deliberately. A storefront footer is a boundary — it should
    // close the page rather than fade out of it, and near-black under a white
    // catalogue is the standard retail cadence.
    //
    // Fixed dark in BOTH colour schemes: `dark:` variants are omitted because
    // the palette below is already the dark one, and letting it invert in dark
    // mode would produce a light slab against a dark page.
    <footer className="mt-20 bg-gray-950 text-gray-400 border-t border-gray-800">
      <div className="storefront-shell py-14">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 mb-12">

          <div>
            <div className="flex items-center gap-2.5 mb-3">
              {s?.logoUrl ? (
                <img src={s.logoUrl} alt=""
                  className="w-8 h-8 rounded-lg object-contain bg-white"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : null}
              <span className="font-semibold tracking-tight text-white">{store.name}</span>
            </div>

            {s?.description && (
              <p className="text-sm leading-relaxed text-gray-400 mb-4 max-w-xs">
                {s.description}
              </p>
            )}

            <div className="space-y-1.5">
              {s?.contactEmail && (
                <a href={`mailto:${s.contactEmail}`} className={`${footLink} flex items-center gap-2`}>
                  <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {s.contactEmail}
                </a>
              )}
              {s?.contactPhone && (
                <a href={`tel:${s.contactPhone}`} className={`${footLink} flex items-center gap-2`}>
                  <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {s.contactPhone}
                </a>
              )}
            </div>

            {/* Named links rather than emoji. lucide dropped brand glyphs, and
                an emoji camera standing in for Instagram is worse than the word. */}
            {socials.length > 0 && (
              <div className="flex gap-4 mt-4">
                {socials.map(([label, href]) => (
                  <a key={label} href={href} target="_blank" rel="noopener noreferrer" className={footLink}>
                    {label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">Shop</h4>
            <ul className="space-y-2.5">
              {shopLinks.map(([label, to]) => (
                <li key={label}>
                  <Link to={to} className={footLink}>{label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white mb-4">Support</h4>
            <ul className="space-y-2.5">
              {s?.contactEmail && (
                <li><a href={`mailto:${s.contactEmail}`} className={footLink}>Contact Us</a></li>
              )}
              <li><Link to={`${base}/orders`} className={footLink}>My Orders</Link></li>
              <li><Link to="/start" className={footLink}>Open Your Own Store</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-500">© {year} {store.name}. All rights reserved.</p>
          <p className="text-xs text-gray-500">
            Powered by{' '}
            <Link to="/" className="font-medium text-white hover:opacity-70 transition-opacity">
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
      <StorefrontShell>
        <div
          className="w-7 h-7 border-2 border-gray-200 border-t-gray-900 rounded-full animate-spin mx-auto
                     dark:border-gray-700 dark:border-t-white"
          role="status"
          aria-label="Loading store"
        />
        <p className="mt-4 text-sm text-gray-500">Loading store…</p>
      </StorefrontShell>
    );
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (state.status === 'not_found') {
    return (
      <StorefrontShell>
        <span className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 grid place-items-center mx-auto mb-5">
          <StoreIcon className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Store not found</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          The store{' '}
          <code className="font-mono text-gray-900 dark:text-gray-200">/{slug}</code>{' '}
          doesn't exist or has been removed.
        </p>
        <div className="flex gap-3 justify-center mt-6">
          <Link to="/" className="btn-primary px-5">Go to Vendbase</Link>
          <Link to="/start" className="btn-secondary px-5">Start a store</Link>
        </div>
      </StorefrontShell>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (state.status === 'error') {
    return (
      <StorefrontShell>
        <span className="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-800 grid place-items-center mx-auto mb-5">
          <AlertTriangle className="w-5 h-5 text-gray-400" aria-hidden="true" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-white">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{state.message}</p>
        <div className="flex gap-3 justify-center mt-6">
          <button onClick={() => setState({ status: 'loading' })} className="btn-primary px-5">
            Retry
          </button>
          <Link to="/" className="btn-secondary px-5">Home</Link>
        </div>
      </StorefrontShell>
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
        {/* No background class here, deliberately.
            This div used to carry `bg-gradient-to-b from-amber-50 to-white`,
            which is both the pale yellow wash across the whole storefront AND
            the reason theme switching looked inert: every theme sets its ground
            with `html[data-store-theme='…'] { background-color: … }`, and an
            opaque gradient on this wrapper painted straight over it. Leaving it
            transparent lets the ground come from <html> — white by default,
            whatever the active theme specifies otherwise. */}
        <div className="min-h-screen flex flex-col">
          <StorefrontNavbar store={store} slug={slug!} />
          <main className="flex-1">
            <Outlet />
          </main>
          <StorefrontFooter store={store} slug={slug!} />
        </div>
      </ThemeProvider>
    </StorefrontProvider>
  );
}
