/**
 * Site-mode resolution — platform vs storefront, decided by hostname.
 *
 * The root domain used to be bound to one store by `VITE_STORE_ID` in
 * vercel.json, so the platform's own address served a single hardcoded tenant.
 * These tests pin the replacement, and in particular the two properties that
 * stop the old failure mode returning:
 *
 *   • an unresolved or failed lookup yields PLATFORM mode, never a guessed
 *     tenant — the whole bug was guessing;
 *   • the dev override is inert in a production build, so the binding cannot be
 *     reintroduced by configuration alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { createElement, ReactNode } from 'react';

import { SiteProvider, useSite } from './contexts/SiteContext';
import { getHostTenant, __resetHostTenant } from './api/activeTenant';
import { resolveDevStoreSlug } from './utils/devStoreOverride';
import type { Store } from './types';

// The provider calls the bare axios module (not the shared instance) because it
// runs before a tenant is known.
const resolveHost = vi.fn();
const resolveSlug = vi.fn();
vi.mock('./api/site', () => ({
  siteApi: {
    resolveHost: (...a: unknown[]) => resolveHost(...a),
    resolveSlug: (...a: unknown[]) => resolveSlug(...a),
  },
}));

function makeStore(slug: string): Store {
  return {
    _id: `id-${slug}`,
    name: slug,
    slug,
    ownerId: 'o1',
    subscriptionPlan: 'free',
    subscriptionStatus: 'active',
    isActive: true,
  } as Store;
}

function ModeProbe() {
  const { mode, store } = useSite();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="store">{store?.slug ?? 'none'}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    createElement(SiteProvider, { children: createElement(ModeProbe) }) as never
  );
}

beforeEach(() => {
  __resetHostTenant();
  resolveHost.mockReset();
  resolveSlug.mockReset();
});

afterEach(cleanup);

describe('site mode', () => {
  it('is storefront when the host maps to a store', async () => {
    resolveHost.mockResolvedValue({ data: { data: { store: makeStore('acme') } } });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('storefront'));
    expect(screen.getByTestId('store').textContent).toBe('acme');
  });

  it('is platform when the host maps to nothing', async () => {
    resolveHost.mockResolvedValue({ data: { data: { store: null } } });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('platform'));
    expect(screen.getByTestId('store').textContent).toBe('none');
  });

  it('falls back to PLATFORM when resolution fails, never to a guessed tenant', async () => {
    // Guessing a tenant on failure is precisely what VITE_STORE_ID did.
    resolveHost.mockRejectedValue(new Error('network down'));

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('platform'));
    expect(getHostTenant()).toBeNull();
  });

  it('starts in loading, so nothing renders against an unresolved tenant', () => {
    resolveHost.mockReturnValue(new Promise(() => {})); // never settles

    renderProvider();

    expect(screen.getByTestId('mode').textContent).toBe('loading');
  });
});

describe('host tenant registry', () => {
  it('publishes the tenant for the axios interceptor in storefront mode', async () => {
    resolveHost.mockResolvedValue({ data: { data: { store: makeStore('acme') } } });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('storefront'));
    expect(getHostTenant()).toEqual({ storeId: 'id-acme', slug: 'acme' });
  });

  it('leaves the registry empty on the platform host', async () => {
    // An empty registry means the interceptor sends NO store header, which is
    // correct: platform routes are not tenant-scoped.
    resolveHost.mockResolvedValue({ data: { data: { store: null } } });

    renderProvider();

    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('platform'));
    expect(getHostTenant()).toBeNull();
  });

  it('is in-memory only, so it cannot survive into another page load', () => {
    // The old mechanism was browser storage, which outlived the context that
    // set it. Nothing is written to sessionStorage or localStorage here.
    expect(sessionStorage.getItem('hostTenant')).toBeNull();
    expect(localStorage.getItem('hostTenant')).toBeNull();
  });
});

describe('dev store override', () => {
  // Tested through the pure gate rather than the component: `vitest run` leaves
  // import.meta.env.DEV true, so a component test cannot exercise the
  // production branch at all — which is the branch that matters.

  it('is ignored in a production build, whatever the value', () => {
    // This is the property that stops VITE_STORE_ID's history repeating: the
    // binding cannot be reintroduced by build configuration.
    expect(resolveDevStoreSlug(false, 'acme')).toBeUndefined();
    expect(resolveDevStoreSlug(false, '  acme  ')).toBeUndefined();
  });

  it('is honoured in a development build', () => {
    expect(resolveDevStoreSlug(true, 'acme')).toBe('acme');
    expect(resolveDevStoreSlug(true, '  acme  ')).toBe('acme');
  });

  it('treats absent or blank as no override', () => {
    expect(resolveDevStoreSlug(true, undefined)).toBeUndefined();
    expect(resolveDevStoreSlug(true, '')).toBeUndefined();
    expect(resolveDevStoreSlug(true, '   ')).toBeUndefined();
  });
});
