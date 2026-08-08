/**
 * StorefrontContext
 *
 * Provides the resolved Store object and a slug-scoped Axios instance to all
 * components rendered under the /s/:slug route tree.
 *
 * This context is ISOLATED from the vendor admin session:
 *  - It uses a dedicated Axios instance that sends X-Store-Slug on every request
 *  - The global Redux store / storeSlice is not touched
 *
 * For shared components (like ProductCard / useAddToCart) that use the global
 * api singleton, StorefrontProvider writes the active slug to sessionStorage
 * under STOREFRONT_SLUG_KEY. The global axios interceptor reads this key and
 * injects X-Store-Slug when X-Store-ID isn't available. This lets cart/wishlist
 * calls work correctly without forking every shared component.
 */

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import axios, { AxiosInstance } from 'axios';
import { Store } from '../types';

// ── Shared sessionStorage key ─────────────────────────────────────────────────
// Written by StorefrontProvider, read by the global axios interceptor in axios.ts
export const STOREFRONT_SLUG_KEY = 'sf_active_slug';

// ── Storefront-scoped Axios instance ─────────────────────────────────────────
// Created once per mount of StorefrontProvider. Sends X-Store-Slug automatically
// so all product/category/cart API calls are scoped to the correct tenant.

export function createStorefrontApi(slug: string): AxiosInstance {
  const instance = axios.create({
    baseURL: '/api/v1',
    headers: {
      'Content-Type': 'application/json',
      'X-Store-Slug': slug,
    },
    withCredentials: true, // needed so auth cookies work for logged-in customers
  });

  // Attach the user's access token if they have one (for cart, wishlist, checkout)
  // but do NOT fall back to storeId/envStoreId — slug header is sufficient.
  instance.interceptors.request.use(config => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  return instance;
}

// ── Context shape ─────────────────────────────────────────────────────────────

interface StorefrontContextValue {
  store: Store;
  slug: string;
  sfApi: AxiosInstance; // storefront-scoped axios instance
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export function useStorefront(): StorefrontContextValue {
  const ctx = useContext(StorefrontContext);
  if (!ctx) throw new Error('useStorefront must be used inside <StorefrontProvider>');
  return ctx;
}

/**
 * Non-throwing variant, for components rendered in BOTH contexts.
 *
 * `useTenant` builds on this: CheckoutPage and the cart hooks run on the main
 * site and inside a storefront, and must be able to ask "am I in a storefront?"
 * without the answer being an exception.
 */
export function useStorefrontOptional(): StorefrontContextValue | null {
  return useContext(StorefrontContext);
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface StorefrontProviderProps {
  store: Store;
  slug: string;
  children: React.ReactNode;
}

export function StorefrontProvider({ store, slug, children }: StorefrontProviderProps) {
  // Rebuilt whenever the slug changes.
  //
  // This was `useState(() => createStorefrontApi(slug))`, annotated "recreated
  // only if the slug changes" — which a useState initializer never does. It
  // runs exactly once per component instance, and React Router reuses the same
  // instance across param changes on the same route. So navigating
  // /s/store-a → /s/store-b in-SPA kept store A's instance, with
  // `X-Store-Slug: store-a` baked into its default headers, and every request
  // on store B's storefront silently read and wrote store A's data.
  //
  // StorefrontLayout additionally mounts this provider with `key={slug}` so the
  // whole subtree is rebuilt on a tenant change; the memo keeps this correct
  // even if that key is ever removed.
  const sfApi = useMemo(() => createStorefrontApi(slug), [slug]);

  // Publish the active slug for shared components (ProductCard, useAddToCart,
  // wishlist) that still go through the global api singleton.
  //
  // Written during RENDER, not in an effect. React flushes child effects before
  // parent effects, so a child page's first fetch fired before this provider's
  // effect had run — the request went out with no slug and the interceptor fell
  // through to the build-time store (then VITE_STORE_ID, since removed), hitting
  // the platform's own shop. Setting it here guarantees it is in place before
  // any descendant renders, let alone fetches.
  //
  // Idempotent, so React's double-invoked render in StrictMode is harmless.
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(STOREFRONT_SLUG_KEY, slug);
  }

  // Cleanup only. Leaving the key set after the storefront unmounts would make
  // main-site requests resolve against the last storefront visited.
  //
  // The guard is load-bearing. React commits the NEW subtree's render before
  // running the OLD one's teardown, so on a slug change the sequence is:
  //   render(store-b) sets 'store-b' → teardown(store-a) fires
  // An unconditional remove there deletes the value that was just written and
  // leaves NO slug at all — dropping every subsequent request down to the next
  // resolution step (the host tenant, or none), which is precisely the
  // wrong-store bug this file exists to prevent. Only clear the key if it still
  // holds the slug we put there.
  useEffect(() => {
    return () => {
      if (sessionStorage.getItem(STOREFRONT_SLUG_KEY) === slug) {
        sessionStorage.removeItem(STOREFRONT_SLUG_KEY);
      }
    };
  }, [slug]);

  const value = useMemo(
    () => ({ store, slug, sfApi }),
    [store, slug, sfApi]
  );

  return (
    <StorefrontContext.Provider value={value}>
      {children}
    </StorefrontContext.Provider>
  );
}
