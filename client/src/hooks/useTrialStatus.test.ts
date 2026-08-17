/**
 * Tests for useTrialStatus.
 *
 * This hook used to BE the paywall. It computed trial expiry in the browser
 * (`createdAt + 7 days`) and AdminLayout rendered a full-screen wall from its
 * `isExpired` flag — while the server checked nothing at all, so clearing
 * localStorage or calling the API directly restored full access to an expired
 * or suspended store.
 *
 * It is now a pure reader of the server-resolved `store.subscription` block.
 * Two properties matter enough to pin:
 *
 *   1. It performs NO date arithmetic of its own. If it ever starts inferring
 *      state again, the client and server can disagree — and only one of them
 *      is actually enforcing.
 *   2. Missing data renders PERMISSIVELY. A failed store fetch must never
 *      paywall a merchant who is paying; the server returns 402 if it truly
 *      matters.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createElement, ReactNode } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';

import storeReducer, { setCurrentStore } from '../store/storeSlice';
import { useTrialStatus } from './useTrialStatus';
import type { Store } from '../types';

type Subscription = NonNullable<Store['subscription']>;

function renderWithSubscription(subscription: Subscription | undefined) {
  const reduxStore = configureStore({ reducer: { currentStore: storeReducer } });

  reduxStore.dispatch(
    setCurrentStore({
      _id: 's1',
      name: 'Test Store',
      slug: 'test-store',
      ownerId: 'o1',
      subscriptionPlan: 'pro',
      subscriptionStatus: 'active',
      isActive: true,
      subscription,
    } as Store)
  );

  // `children` goes in the props object, not as a third argument: react-redux's
  // ProviderProps declares it as required, so the positional form fails tsc
  // even though it works at runtime.
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Provider, { store: reduxStore, children });

  return renderHook(() => useTrialStatus(), { wrapper });
}

const base: Subscription = {
  level: 'full',
  reason: 'active',
  effectivePlan: 'pro',
  isTrialing: false,
  trialEndsAt: null,
  trialDaysRemaining: null,
};

describe('useTrialStatus', () => {
  it('reports a paid active store as paid and unrestricted', () => {
    const { result } = renderWithSubscription(base);
    expect(result.current.isPaid).toBe(true);
    expect(result.current.isRestricted).toBe(false);
    expect(result.current.isTrialOver).toBe(false);
  });

  it('surfaces the server-supplied trial countdown verbatim', () => {
    // The number comes from the server. The hook must not recompute it from
    // any date it happens to have.
    const { result } = renderWithSubscription({
      ...base,
      reason: 'trialing',
      isTrialing: true,
      trialEndsAt: '2099-01-01T00:00:00.000Z',
      trialDaysRemaining: 3,
    });

    expect(result.current.isTrialing).toBe(true);
    expect(result.current.daysRemaining).toBe(3);
    expect(result.current.isRestricted).toBe(false);
  });

  it('treats an ended trial as a downgrade, NOT a lockout', () => {
    // The whole point of the product decision: Free is a permanent $0 tier, so
    // trial end must drive an upsell banner rather than the wall.
    const { result } = renderWithSubscription({
      ...base,
      reason: 'free_tier',
      effectivePlan: 'free',
      isTrialing: false,
    });

    expect(result.current.isTrialOver).toBe(true);
    expect(result.current.isRestricted).toBe(false);
    expect(result.current.effectivePlan).toBe('free');
  });

  it('walls ONLY on a server-reported restriction', () => {
    const { result } = renderWithSubscription({
      ...base,
      level: 'restricted',
      reason: 'suspended',
      effectivePlan: 'free',
    });

    expect(result.current.isRestricted).toBe(true);
    expect(result.current.isPaid).toBe(false);
  });

  it('does not restrict a past_due store still inside the dunning grace', () => {
    const { result } = renderWithSubscription({ ...base, reason: 'grace_period' });
    expect(result.current.isRestricted).toBe(false);
  });

  it('renders permissively when the server has told us nothing', () => {
    // No subscription block: an older API response, or the store has not
    // loaded. Locking here would paywall paying merchants on a transient
    // network failure.
    const { result } = renderWithSubscription(undefined);

    expect(result.current.isRestricted).toBe(false);
    expect(result.current.isTrialOver).toBe(false);
    expect(result.current.daysRemaining).toBe(0);
  });

  it('does not derive state from elapsed time', () => {
    // A store created long ago but reported as trialing stays trialing. The old
    // implementation would have called this expired purely from `createdAt`.
    const { result } = renderWithSubscription({
      ...base,
      reason: 'trialing',
      isTrialing: true,
      trialEndsAt: '2099-01-01T00:00:00.000Z',
      trialDaysRemaining: 5,
    });

    expect(result.current.isTrialing).toBe(true);
    expect(result.current.isTrialOver).toBe(false);
  });
});
