import { z } from 'zod';

export const onboardingSchema = z.object({
  body: z.object({
    fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100).trim(),
    email: z.string().email('Must be a valid email address'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password must be at most 128 characters'),
    storeName: z.string().min(2, 'Store name must be at least 2 characters').max(100).trim(),
    storeCategory: z.enum([
      'fashion',
      'electronics',
      'home',
      'beauty',
      'sports',
      'food',
      'books',
      'toys',
      'jewelry',
      'other',
    ]),
    storeSlug: z
      .string()
      .min(2)
      .max(60)
      .trim()
      .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers, and hyphens')
      .optional(),
  }),
});
