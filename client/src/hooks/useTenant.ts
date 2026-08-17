import { useMemo } from 'react';
import { AxiosInstance } from 'axios';
import globalApi from '../api/axios';
import { useStorefrontOptional } from '../contexts/StorefrontContext';
import { useSite } from '../contexts/SiteContext';
import { useAppSelector } from './useAppDispatch';
import { Store } from '../types';

/**
 * The tenant the current route belongs to.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * Tenancy used to be AMBIENT. The axios interceptor read `sf_active_slug` from
 * sessionStorage, falling back to `localStorage.currentStoreId` and then to the
 * build-time `VITE_STORE_ID`. Nothing in a component said which store it was
 * operating on, so the answer depended on which effects had run, which route
 * had last unmounted, and what happened to be left in browser storage.
 *
 * That produced the checkout routing bug: `/s/:slug/cart` linked to the
 * main-site `/checkout`, which unmounts StorefrontProvider, which deletes
 * `sf_active_slug` on the way out — so the shopper's order was placed against
 * the platform's hardcoded demo store instead of the merchant they were buying
 * from.
 *
 * A component that asks `useTenant()` gets an explicit answer derived from the
 * ROUTE, plus an axios instance already scoped to it. The sessionStorage
 * mechanism survives only as a fallback for shared components that have not
 * been migrated; it is no longer how correctness is achieved.
 *
 * ── Contract ──────────────────────────────────────────────────────────────────
 * Inside `/s/:slug` the storefront context wins, always. Everywhere else the
 * tenant is the admin-selected store from Redux. Never read tenancy from
 * storage in a component.
 */
export interface Tenant {
  /** The resolved store. Null on the main site before it loads. */
  store: Store | null;
  /** Axios instance already scoped to this tenant — use this, not the singleton. */
  api: AxiosInstance;
  /**
   * Stable identifier for cache keys.
   *
   * Any client-side cache holding tenant data MUST include this. React Query
   * keys were bare (`['cart']`), so one store's cart was served on another
   * store's page until the entry went stale.
   */
  key: string;
  /** ISO 4217 code for display. Falls back to USD, never to a wrong store's. */
  currency: string;
  /** Storefront slug, or null on the main site. */
  slug: string | null;
  isStorefront: boolean;
  /**
   * Prefixes an app path with the storefront base when inside one.
   *
   * `path('/cart')` → `/s/acme/cart` in a storefront, `/cart` on the main site.
   * Navigating with a bare literal is what took the shopper out of the tenant
   * tree in the first place.
   */
  path: (p: string) => string;
}

export function useTenant(): Tenant {
  const storefront = useStorefrontOptional();
  const site = useSite();
  const mainStore = useAppSelector(s => s.currentStore.current);

  return useMemo<Tenant>(() => {
    // 1. Path storefront (/s/:slug) — the most specific signal, and the only
    //    one where paths must carry a prefix.
    if (storefront) {
      const { store, slug, sfApi } = storefront;
      return {
        store,
        api: sfApi,
        key: `slug:${slug}`,
        currency: store?.currency ?? 'USD',
        slug,
        isStorefront: true,
        path: (p: string) => `/s/${slug}${p.startsWith('/') ? p : `/${p}`}`,
      };
    }

    // 2. Host storefront — this deployment's domain belongs to a store, so the
    //    customer routes at the ROOT are that store's. Paths stay unprefixed
    //    because the host already carries the tenant.
    if (site.mode === 'storefront' && site.store) {
      return {
        store: site.store,
        api: globalApi,
        key: `host:${site.store._id}`,
        currency: site.store.currency ?? 'USD',
        slug: site.store.slug,
        isStorefront: true,
        path: (p: string) => p,
      };
    }

    // 3. Platform host — the tenant is whatever the merchant selected in the
    //    admin switcher, and is null for an anonymous visitor. It is correct
    //    for this to be null: the platform is not a shop.
    return {
      store: mainStore,
      api: globalApi,
      // Distinguished from the storefront namespaces so a store reachable
      // several ways cannot share a cache entry across contexts.
      key: `id:${mainStore?._id ?? 'none'}`,
      currency: mainStore?.currency ?? 'USD',
      slug: null,
      isStorefront: false,
      path: (p: string) => p,
    };
  }, [storefront, site.mode, site.store, mainStore]);
}
