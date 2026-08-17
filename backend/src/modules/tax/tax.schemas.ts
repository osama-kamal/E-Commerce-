import { z } from 'zod';

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character ID');

const countryCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => v === '*' || /^[A-Z]{2}$/.test(v), {
    message: "Must be a 2-letter ISO country code, or '*' for any country",
  });

const taxRateBody = z.object({
  name: z.string().trim().min(1).max(80),
  // Bounded at the edge as well as in the schema: a rate entered as 2000
  // instead of 20.00 would otherwise produce a total larger than the goods.
  rate: z.number().min(0, 'Rate cannot be negative').max(100, 'Rate cannot exceed 100%'),
  country: countryCode,
  state: z.string().trim().max(64).nullable().optional(),
  appliesToShipping: z.boolean().default(false),
  isActive: z.boolean().optional(),
});

export const createTaxRateSchema = z.object({ body: taxRateBody });

export const updateTaxRateSchema = z.object({
  params: z.object({ id: objectIdString }),
  body: taxRateBody.partial(),
});

export const taxRateIdSchema = z.object({
  params: z.object({ id: objectIdString }),
});
