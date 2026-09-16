import { z } from 'zod';

export const createStoreSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(100).trim(),
    slug: z
      .string()
      .min(2)
      .max(60)
      .trim()
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens'),
    subscriptionPlan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
  }),
});

const slugField = z
  .string()
  .min(2)
  .max(60)
  .trim()
  .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens');

/**
 * A routable hostname, for `customDomain`.
 *
 * Rejects anything that is not a bare host: no scheme, no port, no path, no
 * wildcard, no trailing dot. `resolveStoreByHost` matches this field against a
 * normalised browser hostname, so a value carrying any of those could never
 * match and would only ever sit in the database looking connected.
 *
 * Format alone is not authorisation — see `assertAssignableCustomDomain` in
 * store.service.ts for the platform-hostname guard that runs alongside this.
 */
const customDomainField = z
  .string()
  .trim()
  .toLowerCase()
  .min(4)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    'Must be a bare hostname such as shop.example.com — no scheme, port, path, or wildcard'
  );

/**
 * Owner-editable store fields (PUT /stores/:id).
 *
 * Billing state is deliberately EXCLUDED. `updateMyStore` forwards req.body
 * straight into findOneAndUpdate, so allowing subscriptionPlan here let any
 * store owner grant themselves an enterprise plan for free on their own store.
 *
 * `customDomain` is EXCLUDED for the same class of reason, and it is the more
 * dangerous of the two. `resolveStoreByHost` matches `customDomain` before it
 * considers subdomains, and the field had no format check, no ownership proof,
 * and no denylist — so a merchant on any plan that includes custom domains
 * could claim the platform's OWN hostname and have every visitor to the
 * platform homepage served their storefront instead. Claiming an unrelated
 * third party's hostname worked equally well, first-come-first-served via the
 * unique index.
 *
 * Until DNS ownership verification exists (see DOMAINS.md), a custom domain is
 * an operator-set field: `PATCH /stores/:id/admin`, super-admin only.
 *
 * `.strict()` rather than Zod's default strip, so a forbidden field is an
 * explicit 422 rather than a silent no-op the caller has to infer from the
 * response body.
 */
export const updateMyStoreSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(2).max(100).trim().optional(),
      slug: slugField.optional(),
    })
    .strict(
      'Only name and slug can be changed here. Custom domains and billing plan changes are made by the platform administrator.'
    ),
});

/** Platform-administrator store update (PATCH /stores/:id/admin) — super-admin only. */
export const updateStoreSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(2).max(100).trim().optional(),
      slug: slugField.optional(),
      customDomain: customDomainField.optional(),
      subscriptionPlan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
      subscriptionStatus: z
        .enum(['active', 'trialing', 'past_due', 'cancelled', 'suspended', 'pending_upgrade'])
        .optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

export const storeIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
