/**
 * Dev-only store override resolution.
 *
 * Extracted from SiteContext so the gate is pure and directly testable, for the
 * same reason `checkoutMode.ts` exists: it is a bypass, and a bypass that can
 * only be exercised through a component is a bypass nobody verifies.
 *
 * ── What it guards ────────────────────────────────────────────────────────────
 * On localhost there is no tenant subdomain, so a developer needs some way to
 * make the root behave like a storefront. `VITE_DEV_STORE_SLUG` does that.
 *
 * The hazard is history repeating: `VITE_STORE_ID` began as exactly this kind
 * of convenience and ended up as the production tenancy mechanism, hardcoded
 * into vercel.json and binding the platform's own domain to one shop. This gate
 * makes that impossible — in a production build the override is ignored no
 * matter what value was baked in at build time, so the binding cannot come back
 * through configuration.
 */

/**
 * @param isDev  `import.meta.env.DEV` — true only for a development build
 * @param rawSlug value of `VITE_DEV_STORE_SLUG`
 * @returns the slug to force, or `undefined` to resolve normally by host
 */
export function resolveDevStoreSlug(
  isDev: boolean,
  rawSlug: string | undefined | null
): string | undefined {
  if (!isDev) return undefined;
  const slug = rawSlug?.trim();
  return slug ? slug : undefined;
}
