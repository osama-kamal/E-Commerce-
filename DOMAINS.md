# Domains & tenant routing

How a request reaches the right store, and what has to exist outside this repo
for subdomains and custom domains to work.

## What changed

The frontend used to be bound to one store at build time (`VITE_STORE_ID`,
pinned in `client/vercel.json`). The platform's own domain therefore served a
single hardcoded tenant — the platform and one of its shops were the same page,
and the backend's host-resolution logic was unreachable.

The tenant is now resolved at runtime from the hostname. One build serves the
platform on the platform's domain and the correct storefront on every tenant
domain.

## Resolution order

Decided once per page load by `client/src/contexts/SiteContext.tsx`, which calls
`GET /api/v1/stores/resolve?host=<hostname>`:

| Host | Resolves to | Mode |
|---|---|---|
| `shop.acme.com` (matches `store.customDomain`) | that store | storefront |
| `acme.vendbase.com` (first label matches `store.slug`) | that store | storefront |
| `vendbase.com`, `localhost`, `*.vercel.app` | nothing | platform |

Within the app, `useTenant()` resolves in this order:

1. **Path storefront** — `/s/:slug`, the most specific signal
2. **Host tenant** — the domain belongs to a store
3. **Admin selection** — the store chosen in the switcher, platform host only

Host outranks the admin selection deliberately: a shopper on `shop.acme.com`
must see Acme even if that browser once administered a different store.

### Why the hostname is sent explicitly

`resolveStore` middleware already inspects `req.headers.host`, but in the
deployed topology the frontend rewrites `/api/*` to the backend, so the backend
sees its OWN host and never the shopper's. Those branches are dead in
production. The SPA passes the hostname it is actually being served on.

This is not a privilege escalation: storefronts are public, callers can already
select a tenant with `X-Store-Slug`, and every authenticated action is still
cross-checked against the JWT's `storeId` in `authenticateJWT`. Host resolution
only decides which public catalogue to render.

### Reserved subdomains

`www`, `api`, `admin`, `app`, `dashboard`, `staging`, `preview`, `mail`, `cdn`,
`assets` never resolve to a tenant. `api` and `admin` are real platform hosts —
without this, a tenant could register a matching slug and capture traffic meant
for platform infrastructure. A store whose slug collides is still reachable by
custom domain and by `/s/:slug`.

## Infrastructure required (not in this repo)

**Nothing below is needed for `/s/:slug`, which works today with no DNS.**

### Subdomains — `acme.vendbase.com`

1. Wildcard DNS: `*.vendbase.com` → the frontend host
2. Wildcard TLS certificate for `*.vendbase.com`
3. On Vercel: add `*.vendbase.com` as a domain on the project

Note a wildcard certificate covers one level only — `acme.vendbase.com` is
covered, `shop.acme.vendbase.com` is not.

### Custom domains — `shop.acme.com`

1. The merchant adds a CNAME to the frontend host
2. **Ownership verification** before serving — not yet built
3. Per-domain certificate issuance (Vercel Domains API, or ACME/Let's Encrypt)

Because (2) does not exist, `customDomain` is an **operator-set field** and the
code enforces that:

- `PUT /stores/:id` (owner) rejects the field outright — 422 from
  `updateMyStoreSchema`, plus a 403 in `updateStore` so the rule survives a
  future route being wired to that service.
- `PATCH /stores/:id/admin` (super-admin) is the only path that may set one. It
  validates the hostname format, refuses any platform hostname via
  `assertAssignableCustomDomain`, still enforces the plan's `customDomain`
  capability, and reports an already-connected domain as 409 rather than a
  duplicate-key 500.
- `PATCH /stores/:id/settings` never touches the field — that service builds an
  explicit allowlist.

`store-settings-authz.integration.test.ts` and `plan-limits.integration.test.ts`
pin all of the above.

**Why it is locked rather than merely gated.** `resolveStoreByHost` matches
`customDomain` *before* it considers subdomains, so the reserved-subdomain list
protects the subdomain branch and nothing else. While the field was self-serve,
a merchant on any plan that includes custom domains could set it to the
platform's own hostname and have every visitor to the platform homepage served
their storefront — one paid subscription, whole platform. Claiming an unrelated
third party's hostname worked equally well, first-come-first-served on the
unique index.

`assertAssignableCustomDomain` is a containment guard, not proof of ownership:
it stops a tenant capturing the *platform*, and it cannot stop one claiming
someone else's domain. That is what step (2) is for. Merchants request a domain
through support until it ships.

### Backend CORS

`CORS_ORIGINS` must include every origin that will call the API. With wildcard
subdomains that means either enumerating them or matching a pattern —
`backend/src/app.ts` currently takes an exact-match list.

## Behaviour today, before any DNS work

Every host resolves to platform mode, so:

- the root domain shows the platform landing page, signup, login and `/admin`
- storefronts are reachable at `/s/<slug>`
- nothing is broken by the absence of DNS; subdomain and custom-domain support
  activates the moment records exist

## Local development

There is no tenant subdomain on `localhost`, so the root is always platform
mode. Two options:

- reach a storefront at `http://localhost:5173/s/<slug>`
- set `VITE_DEV_STORE_SLUG=<slug>` to make the root behave like that store

The override is ignored in any production build
(`client/src/utils/devStoreOverride.ts`), so it cannot become a production
binding the way `VITE_STORE_ID` did.

## The admin dashboard

`/admin` is served on the platform host only. On a tenant domain it redirects to
that store's shop.

The tenant is pinned by the host there, which would conflict with the admin
store switcher — a merchant with two shops could open `/admin` on one domain and
silently edit the other. Keeping the dashboard on the platform host is the same
split as `admin.shopify.com` versus a shop's own domain.
