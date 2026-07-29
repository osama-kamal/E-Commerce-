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
 * Owner-editable store fields (PUT /stores/:id).
 *
 * Billing state is deliberately EXCLUDED. `updateMyStore` forwards req.body
 * straight into findOneAndUpdate, so allowing subscriptionPlan here let any
 * store owner grant themselves an enterprise plan for free on their own store.
 *
 * `.strict()` rather than Zod's default strip: the `validate` middleware does
 * not write the parsed body back onto req, so the controller reads the RAW
 * body. Only rejection actually blocks a forbidden field.
 */
export const updateMyStoreSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(2).max(100).trim().optional(),
      slug: slugField.optional(),
      customDomain: z.string().trim().optional(),
    })
    .strict('Only name, slug and customDomain can be changed here. Billing plan changes are made by the platform administrator.'),
});

/** Platform-administrator store update (PATCH /stores/:id/admin) — super-admin only. */
export const updateStoreSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(2).max(100).trim().optional(),
      slug: slugField.optional(),
      customDomain: z.string().trim().optional(),
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
