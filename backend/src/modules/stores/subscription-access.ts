/**
 * Subscription entitlement and access resolution.
 *
 * This is the single source of truth for two SEPARATE questions that were
 * previously conflated (and answered only in the browser):
 *
 *   1. ENTITLEMENT — whose plan limits apply right now?  (`effectivePlan`)
 *   2. ACCESS      — may this tenant still transact at all? (`level`)
 *
 * They are orthogonal. A store whose trial lapsed keeps working, just at free
 * limits (entitlement changed, access unchanged). A store that stopped paying
 * after the dunning grace is cut off entirely (both changed).
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * `subscriptionStatus` was written by the Stripe webhooks and the dunning job
 * and never read as a gate anywhere on the server. Trial expiry was computed in
 * the browser from `createdAt` and enforced by a React component that merely
 * hid the dashboard. Clearing localStorage — or calling the API directly —
 * restored full access to a suspended, non-paying store.
 *
 * ── Design rules ──────────────────────────────────────────────────────────────
 *  • PURE. No database, no config, no clock of its own — `now` is injected so
 *    every row of the matrix below is directly testable.
 *  • FAIL OPEN on missing data, FAIL CLOSED on known-bad state. An un-migrated
 *    store (no `trialEndsAt` key at all) is never locked out by surprise; a
 *    store explicitly marked `suspended` always is.
 *  • Entitlement never exceeds what was paid for. `runDunningJob` suspends a
 *    store without touching `subscriptionPlan`, so a lapsed Pro store still
 *    reads `subscriptionPlan: 'pro'`. Callers MUST use `effectivePlan`, never
 *    the raw field, when enforcing quotas.
 */

import { SubscriptionPlan } from '../../config/planLimits';

/** Length of the free trial granted to a newly created store. */
export const TRIAL_DAYS = 7;

/** Milliseconds in a day — extracted so the arithmetic below reads cleanly. */
const DAY_MS = 24 * 60 * 60 * 1000;

const KNOWN_PLANS: readonly SubscriptionPlan[] = ['free', 'starter', 'pro', 'enterprise'];

export type AccessLevel =
  /** Everything works, subject to `effectivePlan`'s quotas. */
  | 'full'
  /** Reads only. Writes and new orders are refused with HTTP 402. */
  | 'restricted';

export type AccessReason =
  /** Paid plan, payments current. */
  | 'active'
  /** Inside the free-trial window. */
  | 'trialing'
  /** Payment failed but still inside the dunning grace period. */
  | 'grace_period'
  /** Upgrade requested, awaiting activation — never punish someone mid-payment. */
  | 'pending_upgrade'
  /** Trial ended or subscription lapsed. Store still works, at free limits. */
  | 'free_tier'
  /** Dunning grace exhausted. The only state that actually restricts access. */
  | 'suspended';

export interface SubscriptionAccess {
  level: AccessLevel;
  /** The plan whose limits callers must enforce. NOT necessarily what was purchased. */
  effectivePlan: SubscriptionPlan;
  reason: AccessReason;
  isTrialing: boolean;
  trialEndsAt: Date | null;
  /** Whole days left in the trial, floored at 0. `null` when not trialing. */
  trialDaysRemaining: number | null;
}

/**
 * Structural type rather than `IStore`, so this accepts a Mongoose document, a
 * `.lean()` result, or a plain fixture in a unit test without casting.
 */
export interface SubscriptionStoreFields {
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  trialEndsAt?: Date | string | null;
}

function normalisePlan(value: unknown): SubscriptionPlan {
  return KNOWN_PLANS.includes(value as SubscriptionPlan) ? (value as SubscriptionPlan) : 'free';
}

/**
 * Three-way read of `trialEndsAt`, because the two falsy cases mean opposite
 * things and collapsing them would either lock out every legacy store or leak
 * access to every paid one:
 *
 *   • `undefined` — the key is absent. Document predates this field and has not
 *     been migrated. Reported as `unmigrated`; treated as a trial that has NOT
 *     expired, so enforcement is inert until `migrate:trial-ends-at` runs.
 *   • `null`      — explicitly not on a trial (paid, or trial already resolved).
 *   • `Date`      — a real deadline to compare against.
 *
 * ⚠️  `.lean()` vs hydrated reads differ here, and it matters.
 * A lean read returns raw BSON, so an un-migrated document yields `undefined`
 * (→ `unmigrated`, fails open). A HYDRATED read applies the schema default, so
 * the same document yields `null` (→ `none`, and a trialing store would drop to
 * free entitlement). Every current caller reads lean — resolveStore,
 * product.service.createProduct and order.service.placeOrder all use `.lean()`
 * — which is the safe side. Running the backfill removes the ambiguity
 * entirely; until then, prefer lean reads at call sites that feed this.
 */
function readTrialEnd(
  value: Date | string | null | undefined
): { kind: 'unmigrated' } | { kind: 'none' } | { kind: 'date'; at: Date } {
  if (value === undefined) return { kind: 'unmigrated' };
  if (value === null) return { kind: 'none' };

  const at = value instanceof Date ? value : new Date(value);
  // An unparseable value is corrupt data, not a deadline. Treat it like a
  // missing migration rather than an instantly-expired trial.
  if (Number.isNaN(at.getTime())) return { kind: 'unmigrated' };
  return { kind: 'date', at };
}

function daysRemaining(endsAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * Resolves a store's current entitlement and access level.
 *
 * The full matrix:
 *
 * | status          | trial state    | effectivePlan | level      | reason          |
 * |-----------------|----------------|---------------|------------|-----------------|
 * | active          | —              | declared      | full       | active          |
 * | past_due        | —              | declared      | full       | grace_period    |
 * | pending_upgrade | —              | declared      | full       | pending_upgrade |
 * | trialing        | within window  | declared      | full       | trialing        |
 * | trialing        | unmigrated     | declared      | full       | trialing        |
 * | trialing        | expired / none | free          | full       | free_tier       |
 * | cancelled       | —              | free          | full       | free_tier       |
 * | suspended       | —              | free          | restricted | suspended       |
 *
 * `cancelled` deliberately stays usable: Free is sold as a permanent $0 tier on
 * the pricing page, so cancelling a paid plan is a downgrade, not an eviction.
 * `suspended` is the only eviction, and it is reached solely by
 * `runDunningJob` after 7 days of failed payment.
 *
 * @param now injected for testability; defaults to the real clock.
 */
export function resolveSubscriptionAccess(
  store: SubscriptionStoreFields,
  now: Date = new Date()
): SubscriptionAccess {
  const declaredPlan = normalisePlan(store.subscriptionPlan);
  // A store with no status recorded is treated as trialing, matching the schema
  // default, rather than falling through to a restrictive branch.
  const status = store.subscriptionStatus ?? 'trialing';
  const trial = readTrialEnd(store.trialEndsAt);

  const notTrialing = {
    isTrialing: false,
    trialEndsAt: trial.kind === 'date' ? trial.at : null,
    trialDaysRemaining: null,
  } as const;

  switch (status) {
    // ── The only restricting state ──────────────────────────────────────────
    case 'suspended':
      return { level: 'restricted', effectivePlan: 'free', reason: 'suspended', ...notTrialing };

    // ── Lapsed but still welcome, at free limits ────────────────────────────
    case 'cancelled':
      return { level: 'full', effectivePlan: 'free', reason: 'free_tier', ...notTrialing };

    // ── Payment in flight — never restrict, never downgrade ─────────────────
    case 'past_due':
      return { level: 'full', effectivePlan: declaredPlan, reason: 'grace_period', ...notTrialing };

    case 'pending_upgrade':
      return {
        level: 'full',
        effectivePlan: declaredPlan,
        reason: 'pending_upgrade',
        ...notTrialing,
      };

    case 'active':
      return { level: 'full', effectivePlan: declaredPlan, reason: 'active', ...notTrialing };

    // ── Trial, and anything unrecognised ────────────────────────────────────
    // An unknown status falls here rather than into a restrictive default:
    // a typo or a status added in a later release must not cut off a paying
    // tenant. `suspended` is reached only by being written explicitly.
    case 'trialing':
    default: {
      if (trial.kind === 'unmigrated') {
        // Enforcement is inert until the backfill runs.
        return {
          level: 'full',
          effectivePlan: declaredPlan,
          reason: 'trialing',
          isTrialing: true,
          trialEndsAt: null,
          trialDaysRemaining: null,
        };
      }

      if (trial.kind === 'date' && trial.at.getTime() > now.getTime()) {
        return {
          level: 'full',
          effectivePlan: declaredPlan,
          reason: 'trialing',
          isTrialing: true,
          trialEndsAt: trial.at,
          trialDaysRemaining: daysRemaining(trial.at, now),
        };
      }

      // Trial over (or never started). Drop to the free tier and keep going.
      return {
        level: 'full',
        effectivePlan: 'free',
        reason: 'free_tier',
        isTrialing: false,
        trialEndsAt: trial.kind === 'date' ? trial.at : null,
        trialDaysRemaining: 0,
      };
    }
  }
}

/** Convenience predicate for call sites that only care about the gate. */
export function isRestricted(access: SubscriptionAccess): boolean {
  return access.level === 'restricted';
}

/** The trial deadline to stamp on a store being created right now. */
export function trialEndFrom(createdAt: Date, trialDays: number = TRIAL_DAYS): Date {
  return new Date(createdAt.getTime() + trialDays * DAY_MS);
}
