/**
 * SiteContext — is this page load the PLATFORM or a tenant STOREFRONT?
 *
 * ── The problem this replaces ─────────────────────────────────────────────────
 * The root domain was hard-bound to one store by a build-time literal
 * (`VITE_STORE_ID` in vercel.json). Every main-site route — home, product,
 * cart, checkout, orders — operated on that one tenant, so the "multi-tenant
 * SaaS platform" served exactly one shop at its own address, and the platform
 * and a tenant were the same surface.
 *
 * The mode is now resolved from the HOSTNAME at boot:
 *
 *   shop.acme.com        → custom domain  → storefront mode
 *   acme.vendbase.com    → subdomain      → storefront mode
 *   vendbase.com         → no tenant      → platform mode
 *   localhost            → platform mode, unless VITE_DEV_STORE_SLUG is set
 *
 * `/s/:slug` is unaffected and works in both modes — it is the path-based way
 * to reach any storefront and needs no DNS.
 *
 * ── Deployment requirement ───────────────────────────────────────────────────
 * Subdomain and custom-domain modes need DNS and TLS that live outside this
 * repo: a wildcard record (`*.vendbase.com`) with a matching certificate, and
 * per-domain verification plus certificate issuance for custom domains. Until
 * that exists, every host resolves to platform mode and `/s/:slug` remains the
 * working route. Nothing here breaks in the meantime.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { siteApi } from '../api/site';
import { setHostTenant } from '../api/activeTenant';
import { resolveDevStoreSlug } from '../utils/devStoreOverride';
import { Store } from '../types';

export type SiteMode = 'loading' | 'platform' | 'storefront';

export interface SiteContextValue {
  mode: SiteMode;
  /** The tenant this host serves. Non-null only in storefront mode. */
  store: Store | null;
}

const SiteContext = createContext<SiteContextValue>({ mode: 'loading', store: null });

export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}

/**
 * Dev-only store override. The gate itself lives in `utils/devStoreOverride.ts`
 * as a pure function so both branches are directly testable — see that file for
 * why a bypass like this must not be verifiable only through a component.
 */
function devStoreSlug(): string | undefined {
  return resolveDevStoreSlug(
    import.meta.env.DEV,
    import.meta.env.VITE_DEV_STORE_SLUG as string | undefined
  );
}

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SiteContextValue>({ mode: 'loading', store: null });

  useEffect(() => {
    let cancelled = false;

    const adopt = (store: Store | null) => {
      if (cancelled) return;
      // Publish for the non-React axios singleton BEFORE flipping the mode, so
      // no route can render and fetch against an unset tenant.
      setHostTenant(store ? { storeId: store._id, slug: store.slug } : null);
      setState({ mode: store ? 'storefront' : 'platform', store });
    };

    const slug = devStoreSlug();
    if (slug) {
      siteApi
        .resolveSlug(slug)
        .then(res => adopt(res.data.data ?? null))
        .catch(() => {
          // A typo'd dev slug should be obvious, not silently platform mode.
          console.error(
            `[site] VITE_DEV_STORE_SLUG="${slug}" did not match a store. Falling back to platform mode.`
          );
          adopt(null);
        });
      return () => { cancelled = true; };
    }

    siteApi
      .resolveHost(window.location.hostname)
      .then(res => adopt(res.data.data.store ?? null))
      .catch(() => {
        // Resolution failed (offline, backend down). Platform mode is the safe
        // default: it shows the marketing surface rather than a broken shop,
        // and never guesses at a tenant.
        adopt(null);
      });

    return () => { cancelled = true; };
  }, []);

  const value = useMemo(() => state, [state]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
