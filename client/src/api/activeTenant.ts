/**
 * The tenant this browser tab is serving, resolved once from the hostname.
 *
 * ── Why a module singleton and not sessionStorage ────────────────────────────
 * The axios interceptor is created outside React, so it needs SOME channel to
 * learn the tenant. The previous mechanism was browser storage, which caused
 * every routing bug in this area: it survived reloads, survived navigation out
 * of the context that set it, was shared across tabs of different stores, and
 * could be edited by hand.
 *
 * An in-memory module variable has none of those properties. It is scoped to
 * one page load, cannot be inspected or forged by a user, and starts empty on
 * every navigation — so a stale value can never outlive the context that set
 * it. It is written exactly once, by SiteProvider, at boot.
 *
 * This is NOT the mechanism components should use. Components ask `useTenant()`,
 * which resolves from the route. This exists solely so the non-React axios
 * singleton can attach the right header.
 */

export interface HostTenant {
  storeId: string;
  slug: string;
}

let hostTenant: HostTenant | null = null;

/** Called once by SiteProvider after host resolution completes. */
export function setHostTenant(tenant: HostTenant | null): void {
  hostTenant = tenant;
}

/** Read by the axios interceptor. Null on the platform host. */
export function getHostTenant(): HostTenant | null {
  return hostTenant;
}

/** Test helper — resets module state between cases. */
export function __resetHostTenant(): void {
  hostTenant = null;
}
