import { useMemo } from 'react';
import { useAppSelector } from './useAppDispatch';

/**
 * Reads the store's subscription state.
 *
 * ⚠️  This hook REPORTS state; it does not decide it.
 *
 * It previously computed trial expiry in the browser (`createdAt + 7 days`) and
 * that computation was the only thing standing between an expired trial and
 * full use of the product — the server never checked. Clearing localStorage, or
 * calling the API directly, restored everything. Trial length, entitlement and
 * access are now resolved server-side in `subscription-access.ts` and delivered
 * on the store payload; this hook only unpacks them for rendering.
 *
 * Do not reintroduce date arithmetic here. If a value is missing the correct
 * response is to render permissively and let the API answer with 402 — never to
 * guess, and never to lock the UI on absent data.
 */

/** Mirrors TRIAL_DAYS in backend/src/modules/stores/subscription-access.ts. */
const TRIAL_DAYS = 7;

export interface TrialStatus {
  /** Whole days left in the trial. 0 when not trialing. */
  daysRemaining: number;
  /** Inside the trial window. */
  isTrialing: boolean;
  /** On a paid plan with payments current. */
  isPaid: boolean;
  /**
   * The trial window has closed.
   *
   * This is NOT a lockout. Free is sold as a permanent $0 tier, so a store past
   * its trial keeps working under free limits — this flag drives an upsell, not
   * a wall. The old `isExpired` flag conflated the two and hard-walled the
   * whole dashboard on trial end.
   */
  isTrialOver: boolean;
  /**
   * The server has restricted this store — reads only, no orders or changes.
   * Reached solely via `subscriptionStatus: 'suspended'`, i.e. payment failed
   * and the dunning grace period ran out. The only state that walls the UI.
   */
  isRestricted: boolean;
  /** The plan whose limits actually apply right now. */
  effectivePlan: string;
  /** 0–100 progress through the trial window. */
  progressPercent: number;
}

/**
 * Used when the server has told us nothing yet. Deliberately unrestricted: a
 * store that has not loaded, or an API response predating the subscription
 * block, must not paywall a merchant who may well be paying.
 */
const PERMISSIVE: TrialStatus = {
  daysRemaining: 0,
  isTrialing: false,
  isPaid: false,
  isTrialOver: false,
  isRestricted: false,
  effectivePlan: 'free',
  progressPercent: 0,
};

export function useTrialStatus(): TrialStatus {
  const subscription = useAppSelector(s => s.currentStore.current?.subscription);

  return useMemo(() => {
    if (!subscription) return PERMISSIVE;

    const daysRemaining = subscription.trialDaysRemaining ?? 0;

    return {
      daysRemaining,
      isTrialing: subscription.isTrialing,
      isPaid: subscription.reason === 'active',
      isTrialOver: subscription.reason === 'free_tier',
      isRestricted: subscription.level === 'restricted',
      effectivePlan: subscription.effectivePlan,
      progressPercent: subscription.isTrialing
        ? Math.min(100, Math.max(0, Math.round(((TRIAL_DAYS - daysRemaining) / TRIAL_DAYS) * 100)))
        : 100,
    };
  }, [subscription]);
}
