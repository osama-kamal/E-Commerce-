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

export const updateStoreSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().min(2).max(100).trim().optional(),
    slug: z
      .string()
      .min(2)
      .max(60)
      .trim()
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens')
      .optional(),
    customDomain: z.string().trim().optional(),
    subscriptionPlan: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
    subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'cancelled', 'suspended']).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const storeIdSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});
