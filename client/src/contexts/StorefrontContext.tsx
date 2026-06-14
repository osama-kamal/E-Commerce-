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

import React, { createContext, useContext, useEffect, useState } from 'react';
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

// ── Provider ──────────────────────────────────────────────────────────────────

interface StorefrontProviderProps {
  store: Store;
  slug: string;
  children: React.ReactNode;
}

export function StorefrontProvider({ store, slug, children }: StorefrontProviderProps) {
  // Stable axios instance — recreated only if the slug changes
  const [sfApi] = useState(() => createStorefrontApi(slug));

  // Write the active storefront slug to sessionStorage so the global axios
  // interceptor can inject X-Store-Slug for shared components (ProductCard,
  // useAddToCart, etc.) that use the global api singleton.
  useEffect(() => {
    sessionStorage.setItem(STOREFRONT_SLUG_KEY, slug);
    return () => {
      sessionStorage.removeItem(STOREFRONT_SLUG_KEY);
    };
  }, [slug]);

  return (
    <StorefrontContext.Provider value={{ store, slug, sfApi }}>
      {children}
    </StorefrontContext.Provider>
  );
}
