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
