import { useMemo } from 'react';
import { useAppSelector } from './useAppDispatch';

const TRIAL_DAYS = 7; // ← set to 0 for testing, revert to 7 for production
// Safety: these flags are only active in development. In production they are always false.
const FORCE_TRIAL_EXPIRED = import.meta.env.DEV && false; // ← toggle for UI testing

export interface TrialStatus {
  /** Days remaining in the trial (0 = expired today, negative = already expired) */
  daysRemaining: number;
  /** True while the trial is still active (daysRemaining >= 0) */
  isTrialing: boolean;
  /** True when the trial has expired AND the store is not on a paid plan */
  isExpired: boolean;
  /** True when the store is on a paid active plan (no wall) */
  isPaid: boolean;
  /** 0–100 progress through the trial period */
  progressPercent: number;
}

export function useTrialStatus(): TrialStatus {
  const currentStore = useAppSelector(s => s.currentStore.current);

  return useMemo(() => {
    if (!currentStore) {
      return { daysRemaining: TRIAL_DAYS, isTrialing: true, isExpired: false, isPaid: false, progressPercent: 0 };
    }

    const plan = currentStore.subscriptionPlan;
    const status = currentStore.subscriptionStatus;

    // Paid plans are never blocked
    const isPaid = (plan === 'starter' || plan === 'pro' || plan === 'enterprise') && status === 'active';
    if (isPaid) {
      return { daysRemaining: 999, isTrialing: false, isExpired: false, isPaid: true, progressPercent: 100 };
    }

    // Force-expired override for UI testing
    if (FORCE_TRIAL_EXPIRED) {
      return { daysRemaining: -1, isTrialing: false, isExpired: true, isPaid: false, progressPercent: 100 };
    }

    // Calculate trial days from store creation
    const createdAt = new Date(currentStore.createdAt).getTime();
    const now = Date.now();
    const msElapsed = now - createdAt;
    const daysElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(TRIAL_DAYS - daysElapsed, -999);
    const isTrialing = daysRemaining >= 0;
    const isExpired = !isTrialing;
    const progressPercent = Math.min(Math.round((daysElapsed / TRIAL_DAYS) * 100), 100);

    return { daysRemaining, isTrialing, isExpired, isPaid, progressPercent };
  }, [currentStore]);
}
