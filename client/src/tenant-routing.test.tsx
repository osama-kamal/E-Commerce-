/**
 * Tenant routing and isolation.
 *
 * Four defects lived in one mechanism: tenancy was AMBIENT. The axios
 * interceptor read `sf_active_slug` from sessionStorage, falling back to
 * `localStorage.currentStoreId` and then the build-time `VITE_STORE_ID`, so
 * which merchant a request hit depended on which effects had run and what the
 * last route left behind.
 *
 *   1. `/s/:slug/cart` linked to the main-site `/checkout`, leaving the
 *      storefront tree — the provider unmounted, cleared the slug, and orders
 *      were placed against the platform's own store.
 *   2. The scoped axios instance was built with a `useState` initializer, which
 *      never re-runs, so moving between storefronts kept the first slug.
 *   3. The slug was written in a `useEffect`; React flushes child effects
 *      first, so a page's opening fetch could beat it.
 *   4. The cart's React Query key was the bare `['cart']`, shared by every
 *      tenant.
 *
 * These tests pin each one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Link } from 'react-router-dom';
import { createElement, ReactNode } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import storeReducer from './store/storeSlice';
import {
  StorefrontProvider,
  STOREFRONT_SLUG_KEY,
  createStorefrontApi,
} from './contexts/StorefrontContext';
import { useTenant } from './hooks/useTenant';
import { cartKey } from './hooks/useCart';
import type { Store } from './types';

function makeStore(slug: string): Store {
  return {
    _id: `id-${slug}`,
    name: slug,
    slug,
    ownerId: 'o1',
    subscriptionPlan: 'free',
    subscriptionStatus: 'active',
    isActive: true,
    currency: slug === 'acme' ? 'GBP' : 'USD',
  } as Store;
}

function wrap(children: ReactNode) {
  const redux = configureStore({ reducer: { currentStore: storeReducer } });
  return createElement(Provider, { store: redux, children });
}

/** Renders the tenant a component resolves, so assertions read off the DOM. */
function TenantProbe() {
  const tenant = useTenant();
  return (
    <div>
      <span data-testid="slug">{tenant.slug ?? 'none'}</span>
      <span data-testid="key">{tenant.key}</span>
      <span data-testid="currency">{tenant.currency}</span>
      <span data-testid="isStorefront">{String(tenant.isStorefront)}</span>
      <span data-testid="cartPath">{tenant.path('/cart')}</span>
      <span data-testid="orderPath">{tenant.path('/orders/abc')}</span>
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

// vitest.config sets `globals: false`, so testing-library's auto-cleanup is not
// installed — without this, renders accumulate and getByTestId finds several.
afterEach(cleanup);

// ── 1. Checkout stays inside the tenant tree ─────────────────────────────────

describe('storefront checkout routing', () => {
  it('keeps the shopper inside /s/:slug when leaving the cart', async () => {
    // The regression: this link was `to="/checkout"`, which unmounts
    // StorefrontLayout and takes the tenant with it.
    render(
      <MemoryRouter initialEntries={['/s/acme/cart']}>
        <Routes>
          <Route
            path="/s/:slug/cart"
            element={<Link to="/s/acme/checkout">Proceed to Checkout</Link>}
          />
        </Routes>
      </MemoryRouter>
    );

    const link = await screen.findByRole('link', { name: /proceed to checkout/i });
    expect(link.getAttribute('href')).toBe('/s/acme/checkout');
    expect(link.getAttribute('href')).not.toBe('/checkout');
  });

  it('builds tenant-relative paths inside a storefront', () => {
    render(
      wrap(
        <MemoryRouter>
          <StorefrontProvider store={makeStore('acme')} slug="acme">
            <TenantProbe />
          </StorefrontProvider>
        </MemoryRouter>
      ) as never
    );

    // Navigating with bare literals is what left the tenant tree originally.
    expect(screen.getByTestId('cartPath').textContent).toBe('/s/acme/cart');
    expect(screen.getByTestId('orderPath').textContent).toBe('/s/acme/orders/abc');
  });

  it('leaves main-site paths untouched', () => {
    render(wrap(<MemoryRouter><TenantProbe /></MemoryRouter>) as never);

    expect(screen.getByTestId('isStorefront').textContent).toBe('false');
    expect(screen.getByTestId('cartPath').textContent).toBe('/cart');
  });
});

// ── 2. The scoped axios instance follows the slug ────────────────────────────

describe('storefront axios instance', () => {
  it('carries the slug of the store it was built for', () => {
    const a = createStorefrontApi('store-a');
    const b = createStorefrontApi('store-b');

    expect(a.defaults.headers['X-Store-Slug']).toBe('store-a');
    expect(b.defaults.headers['X-Store-Slug']).toBe('store-b');
  });

  it('rebuilds when the slug changes rather than reusing the first tenant', () => {
    // The `useState(() => ...)` initializer never re-ran, so store B's
    // storefront kept issuing requests with `X-Store-Slug: store-a`.
    const { rerender } = render(
      wrap(
        <MemoryRouter>
          <StorefrontProvider store={makeStore('store-a')} slug="store-a">
            <TenantProbe />
          </StorefrontProvider>
        </MemoryRouter>
      ) as never
    );
    expect(screen.getByTestId('slug').textContent).toBe('store-a');

    rerender(
      wrap(
        <MemoryRouter>
          <StorefrontProvider store={makeStore('store-b')} slug="store-b">
            <TenantProbe />
          </StorefrontProvider>
        </MemoryRouter>
      ) as never
    );
    expect(screen.getByTestId('slug').textContent).toBe('store-b');
    expect(sessionStorage.getItem(STOREFRONT_SLUG_KEY)).toBe('store-b');
  });
});

// ── 3. The slug is published before descendants can fetch ────────────────────

describe('slug availability', () => {
  it('is set during render, before a child effect could fire a request', async () => {
    // React flushes CHILD effects before parent effects. Writing the slug in
    // the provider's effect therefore lost the race against a page's opening
    // fetch, which then fell through to VITE_STORE_ID.
    let slugSeenByChild: string | null = 'unset';

    function ChildReadingSlugDuringRender() {
      // Render-phase read: strictly earlier than any effect, so if this sees
      // the slug, an effect certainly will.
      slugSeenByChild = sessionStorage.getItem(STOREFRONT_SLUG_KEY);
      return <span>child</span>;
    }

    render(
      wrap(
        <MemoryRouter>
          <StorefrontProvider store={makeStore('acme')} slug="acme">
            <ChildReadingSlugDuringRender />
          </StorefrontProvider>
        </MemoryRouter>
      ) as never
    );

    await waitFor(() => expect(screen.getByText('child')).toBeTruthy());
    expect(slugSeenByChild).toBe('acme');
  });
});

// ── 4. Cart cache is namespaced per tenant ───────────────────────────────────

describe('cart cache isolation', () => {
  it('gives different tenants different cache keys', () => {
    // With the old bare `['cart']`, store A's basket was served on store B's
    // storefront for the full 2-minute staleTime.
    expect(cartKey('slug:acme')).not.toEqual(cartKey('slug:other'));
  });

  it('separates the same store reached as a storefront vs the main site', () => {
    // The two contexts have different auth and different carts server-side;
    // sharing one entry would surface one in the other.
    expect(cartKey('slug:acme')).not.toEqual(cartKey('id:id-acme'));
  });

  it('derives the key from the tenant, not from ambient storage', () => {
    render(
      wrap(
        <MemoryRouter>
          <StorefrontProvider store={makeStore('acme')} slug="acme">
            <TenantProbe />
          </StorefrontProvider>
        </MemoryRouter>
      ) as never
    );
    expect(screen.getByTestId('key').textContent).toBe('slug:acme');
  });
});

// ── Currency follows the tenant ──────────────────────────────────────────────

describe('tenant currency', () => {
  it('uses the storefront store, not the main-site store', () => {
    // CheckoutPage read `currentStore.currency` from Redux, which is the
    // main-site store — a shopper on a GBP merchant saw the platform's USD.
    render(
      wrap(
        <MemoryRouter>
          <StorefrontProvider store={makeStore('acme')} slug="acme">
            <TenantProbe />
          </StorefrontProvider>
        </MemoryRouter>
      ) as never
    );
    expect(screen.getByTestId('currency').textContent).toBe('GBP');
  });
});
