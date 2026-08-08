import { z } from 'zod';
import { RATE_TYPES } from './shipping.model';

const objectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a valid 24-character ID');

/** ISO-2 country code, or the '*' rest-of-world catch-all. */
const countryCode = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => v === '*' || /^[A-Z]{2}$/.test(v), {
    message: "Must be a 2-letter ISO country code, or '*' for rest of world",
  });

export const quoteSchema = z.object({
  body: z.object({
    // Only the fields that affect zone matching. The full address is supplied
    // later at order time; asking for it here would block a quote behind
    // details the shopper has not typed yet.
    country: countryCode,
    state: z.string().trim().max(64).optional(),
    postalCode: z.string().trim().max(32).optional(),
    // Which option the shopper currently has selected, so the returned totals
    // reflect their actual choice. Omitted on the first call; the server then
    // previews against the first available option.
    shippingRateId: objectIdString.optional(),
  }),
});

export const createZoneSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80),
    countries: z.array(countryCode).min(1, 'A zone needs at least one country'),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const updateZoneSchema = z.object({
  params: z.object({ id: objectIdString }),
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    countries: z.array(countryCode).min(1).optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const zoneIdSchema = z.object({
  params: z.object({ id: objectIdString }),
});

const tierSchema = z.object({
  minSubtotal: z.number().min(0),
  maxSubtotal: z.number().min(0).nullable().optional(),
  amount: z.number().min(0),
});

const rateBody = z.object({
  zoneId: objectIdString,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
  type: z.enum(RATE_TYPES).default('flat'),
  flatAmount: z.number().min(0).default(0),
  freeOverThreshold: z.number().min(0).nullable().optional(),
  tiers: z.array(tierSchema).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const createRateSchema = z.object({ body: rateBody });

export const updateRateSchema = z.object({
  params: z.object({ id: objectIdString }),
  body: rateBody.partial().extend({ zoneId: objectIdString.optional() }),
});

export const rateIdSchema = z.object({
  params: z.object({ id: objectIdString }),
});

export const listRatesSchema = z.object({
  query: z.object({ zoneId: objectIdString.optional() }),
});
