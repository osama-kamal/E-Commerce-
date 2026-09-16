/**
 * The store slug implied by a post-auth `redirect` target.
 *
 * The shared `/login`, `/register` and `/forgot-password` pages live OUTSIDE the
 * `/s/:slug` route tree, so `useTenant()` cannot see which storefront a shopper
 * came from. The store travels in `?redirect=/s/:slug`; this reads it back out so
 * those pages can authenticate against the right tenant and return the shopper
 * to their shop.
 *
 * Only a `/s/:slug` redirect yields a slug. An arbitrary redirect value must
 * never be trusted to choose a tenant or an auth endpoint — that is exactly the
 * cross-tenant hole the storefront/platform split closed.
 */
export function storeSlugFromRedirect(redirect: string | null | undefined): string | null {
  if (!redirect) return null;
  return /^\/s\/([^/?#]+)/.exec(redirect)?.[1] ?? null;
}

/**
 * Appends a `redirect` query to an auth path so the store context survives the
 * hop between the shared auth pages. `to('/register', '/s/acme')` →
 * `/register?redirect=%2Fs%2Facme`; with no redirect it returns the bare path.
 */
export function withRedirect(path: string, redirect: string | null | undefined): string {
  return redirect ? `${path}?redirect=${encodeURIComponent(redirect)}` : path;
}
