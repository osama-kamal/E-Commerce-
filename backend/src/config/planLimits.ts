/**
 * Subscription plan limits.
 * These are enforced on the backend — never trust the frontend alone.
 */

export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  maxProducts: number;       // -1 = unlimited
  maxOrdersPerMonth: number; // -1 = unlimited
  maxStores: number;
  customDomain: boolean;
  apiAccess: boolean;
  removeBranding: boolean;
}

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  free: {
    maxProducts: 15,
    maxOrdersPerMonth: 50,
    maxStores: 1,
    customDomain: false,
    apiAccess: false,
    removeBranding: false,
  },
  starter: {
    maxProducts: 500,
    maxOrdersPerMonth: 500,
    maxStores: 3,
    customDomain: true,
    apiAccess: false,
    removeBranding: false,
  },
  pro: {
    maxProducts: -1,
    maxOrdersPerMonth: -1,
    maxStores: 10,
    customDomain: true,
    apiAccess: true,
    removeBranding: true,
  },
  enterprise: {
    maxProducts: -1,
    maxOrdersPerMonth: -1,
    maxStores: -1,
    customDomain: true,
    apiAccess: true,
    removeBranding: true,
  },
};

export function getPlanLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[plan as SubscriptionPlan] ?? PLAN_LIMITS.free;
}

// ── PriceMap — Stripe Price ID → internal plan ─────────────────────────────────
//
// Built at runtime from environment variables so test/live Price IDs are
// interchangeable without code changes.  The `free` plan has no Stripe Price ID
// and is intentionally excluded from this map.

/** Maps a Stripe Price ID to a paid SubscriptionPlan (never 'free'). */
export type PriceMap = Record<string, Exclude<SubscriptionPlan, 'free'>>;

/**
 * Builds a PriceMap from the three STRIPE_PRICE_* env vars.
 * Only entries whose env var is a non-empty string are included.
 */
export function buildPriceMap(): PriceMap {
  // Lazy import avoids a circular dependency between config → planLimits → config.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cfg = require('./index') as {
    STRIPE_PRICE_STARTER?: string;
    STRIPE_PRICE_PRO?: string;
    STRIPE_PRICE_ENTERPRISE?: string;
  };

  const map: PriceMap = {};

  if (cfg.STRIPE_PRICE_STARTER)   map[cfg.STRIPE_PRICE_STARTER]   = 'starter';
  if (cfg.STRIPE_PRICE_PRO)       map[cfg.STRIPE_PRICE_PRO]       = 'pro';
  if (cfg.STRIPE_PRICE_ENTERPRISE) map[cfg.STRIPE_PRICE_ENTERPRISE] = 'enterprise';

  return map;
}

/**
 * Returns the internal SubscriptionPlan for a given Stripe Price ID.
 * Returns `undefined` — never `'free'` — when the Price ID is unknown.
 */
export function lookupPlan(priceId: string): Exclude<SubscriptionPlan, 'free'> | undefined {
  return buildPriceMap()[priceId];
}
