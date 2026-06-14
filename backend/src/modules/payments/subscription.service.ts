import Stripe from 'stripe';
import { stripe } from '../../config/stripe';
import { Store, SubscriptionStatus } from '../stores/store.model';
import { User } from '../auth/user.model';
import { logger } from '../../utils/logger';
import { lookupPlan } from '../../config/planLimits';

// ── Grace period constant ──────────────────────────────────────────────────────
// Matches Requirement 9 / design doc: 7 days between first payment failure and
// automatic suspension.
const DUNNING_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Resolves the first Price ID found in a Stripe Subscription's items list.
 * Returns undefined when the subscription has no items (shouldn't happen in
 * practice, but keeps TypeScript happy and prevents silent 'free' fallback).
 */
function getPriceId(sub: Stripe.Subscription): string | undefined {
  return sub.items?.data?.[0]?.price?.id;
}

// ── ensureStripeCustomer ───────────────────────────────────────────────────────

/**
 * Creates a Stripe Customer for the given store if one doesn't exist yet,
 * or returns the existing customer ID unchanged.
 *
 * Called from the plan-upgrade flow (admin service) before creating a
 * Stripe Subscription — NOT from webhook handlers.
 *
 * Error contract:
 *  • Stripe API failure  → throw (no partial state written)
 *  • DB write failure    → log ERROR with orphaned cus_xxx, throw
 *    (the orphaned ID is recoverable — link it manually via the log)
 */
export async function ensureStripeCustomer(
  storeId: string,
  ownerEmail: string
): Promise<string> {
  const store = await Store.findById(storeId).lean();

  if (!store) {
    throw new Error(`ensureStripeCustomer: store ${storeId} not found`);
  }

  // Idempotent — already has a customer, nothing to do.
  if (store.stripeCustomerId) {
    return store.stripeCustomerId;
  }

  // Create a new Stripe Customer — throws on API failure (no partial state).
  const customer = await stripe.customers.create({
    email: ownerEmail,
    metadata: { storeId },
  });

  // Persist the new customer ID — if the DB write fails we log the orphaned
  // Stripe ID so it can be recovered and linked manually.
  try {
    await Store.findByIdAndUpdate(storeId, {
      stripeCustomerId: customer.id,
    });
  } catch (dbErr) {
    logger.error('DB write failed after Stripe Customer creation — orphaned customer', {
      storeId,
      stripeCustomerId: customer.id,
      error: (dbErr as Error).message,
    });
    throw dbErr;
  }

  logger.info('Stripe Customer created and linked to store', {
    storeId,
    stripeCustomerId: customer.id,
  });

  return customer.id;
}

// ── Handler 1: customer.subscription.created ──────────────────────────────────

/**
 * Activates a store's plan when Stripe confirms a new subscription.
 *
 * Lookup: stripeCustomerId → Store
 * Mutations on success:
 *   subscriptionPlan          ← PriceMap(priceId)
 *   subscriptionStatus        ← 'active'
 *   stripeSubscriptionId      ← sub.id
 *   subscriptionEndsAt        ← new Date(current_period_end * 1000)
 */
export async function handleSubscriptionCreated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;

  logger.info('Handling customer.subscription.created', {
    eventId: event.id,
    type: event.type,
    stripeCustomerId: sub.customer as string,
    subscriptionId: sub.id,
    status: sub.status,
  });

  // Only activate for active / trialing subscriptions.
  if (sub.status !== 'active' && sub.status !== 'trialing') {
    logger.info('customer.subscription.created — status not active/trialing, skipping', {
      eventId: event.id,
      status: sub.status,
    });
    return;
  }

  // Resolve plan from PriceMap.
  const priceId = getPriceId(sub);
  if (!priceId) {
    logger.warn('customer.subscription.created — no price ID found in subscription items', {
      eventId: event.id,
      subscriptionId: sub.id,
    });
    return;
  }

  const plan = lookupPlan(priceId);
  if (!plan) {
    logger.warn('customer.subscription.created — unrecognised Price ID', {
      eventId: event.id,
      subscriptionId: sub.id,
      priceId,
    });
    return;
  }

  // Find the store.
  const store = await Store.findOne({ stripeCustomerId: sub.customer as string });
  if (!store) {
    logger.warn('customer.subscription.created — no store found for stripeCustomerId', {
      eventId: event.id,
      stripeCustomerId: sub.customer as string,
    });
    return;
  }

  const oldStatus = store.subscriptionStatus;

  await Store.findByIdAndUpdate(store._id, {
    subscriptionPlan: plan,
    subscriptionStatus: 'active' as SubscriptionStatus,
    stripeSubscriptionId: sub.id,
    subscriptionEndsAt: new Date(sub.current_period_end * 1000),
  });

  logger.info('Store subscription activated (subscription.created)', {
    storeId: store._id.toString(),
    oldStatus,
    newStatus: 'active',
    plan,
    subscriptionId: sub.id,
  });
}

// ── Handler 2: customer.subscription.updated ──────────────────────────────────

/**
 * Syncs a store's plan and status whenever Stripe updates a subscription.
 * Handles renewals, plan changes, past_due marking, and cancellations.
 *
 * Lookup: stripeSubscriptionId → Store
 * Mutations depend on sub.status:
 *   active    → update plan + status + endsAt
 *   past_due  → set status only (plan unchanged)
 *   canceled  → revert to free, clear endsAt
 *   unpaid    → same as canceled
 */
export async function handleSubscriptionUpdated(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;

  logger.info('Handling customer.subscription.updated', {
    eventId: event.id,
    type: event.type,
    subscriptionId: sub.id,
    status: sub.status,
  });

  const store = await Store.findOne({ stripeSubscriptionId: sub.id });
  if (!store) {
    logger.warn('customer.subscription.updated — no store found for stripeSubscriptionId', {
      eventId: event.id,
      stripeSubscriptionId: sub.id,
    });
    return;
  }

  const oldStatus = store.subscriptionStatus;

  if (sub.status === 'active') {
    const priceId = getPriceId(sub);
    if (!priceId) {
      logger.warn('customer.subscription.updated (active) — no price ID in items', {
        eventId: event.id,
        subscriptionId: sub.id,
      });
      return;
    }

    const plan = lookupPlan(priceId);
    if (!plan) {
      logger.warn('customer.subscription.updated (active) — unrecognised Price ID', {
        eventId: event.id,
        subscriptionId: sub.id,
        priceId,
      });
      return;
    }

    await Store.findByIdAndUpdate(store._id, {
      subscriptionPlan: plan,
      subscriptionStatus: 'active' as SubscriptionStatus,
      subscriptionEndsAt: new Date(sub.current_period_end * 1000),
    });

    logger.info('Store subscription updated to active', {
      storeId: store._id.toString(),
      oldStatus,
      newStatus: 'active',
      plan,
    });

  } else if (sub.status === 'past_due') {
    // Status changes but plan is deliberately preserved.
    await Store.findByIdAndUpdate(store._id, {
      subscriptionStatus: 'past_due' as SubscriptionStatus,
    });

    logger.info('Store subscription marked past_due (plan preserved)', {
      storeId: store._id.toString(),
      oldStatus,
      newStatus: 'past_due',
      plan: store.subscriptionPlan,
    });

  } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
    await Store.findByIdAndUpdate(store._id, {
      subscriptionStatus: 'cancelled' as SubscriptionStatus,
      subscriptionPlan: 'free',
      subscriptionEndsAt: null,
    });

    logger.info('Store subscription cancelled — reverted to free', {
      storeId: store._id.toString(),
      oldStatus,
      newStatus: 'cancelled',
      stripeStatus: sub.status,
    });

  } else {
    // Unrecognised status — log and do nothing.
    logger.info('customer.subscription.updated — unhandled Stripe status, no action', {
      eventId: event.id,
      subscriptionId: sub.id,
      stripeStatus: sub.status,
    });
  }
}

// ── Handler 3: customer.subscription.deleted ──────────────────────────────────

/**
 * Reverts a store to the free plan when its Stripe subscription is deleted.
 * Also clears stripeSubscriptionId to prevent future event mis-routing.
 *
 * Lookup: stripeSubscriptionId → Store
 * Mutations:
 *   subscriptionStatus        ← 'cancelled'
 *   subscriptionPlan          ← 'free'
 *   subscriptionEndsAt        ← null
 *   stripeSubscriptionId      ← null
 */
export async function handleSubscriptionDeleted(event: Stripe.Event): Promise<void> {
  const sub = event.data.object as Stripe.Subscription;

  logger.info('Handling customer.subscription.deleted', {
    eventId: event.id,
    type: event.type,
    subscriptionId: sub.id,
  });

  const store = await Store.findOne({ stripeSubscriptionId: sub.id });
  if (!store) {
    logger.warn('customer.subscription.deleted — no store found for stripeSubscriptionId', {
      eventId: event.id,
      stripeSubscriptionId: sub.id,
    });
    return;
  }

  const oldStatus = store.subscriptionStatus;

  await Store.findByIdAndUpdate(store._id, {
    subscriptionStatus: 'cancelled' as SubscriptionStatus,
    subscriptionPlan: 'free',
    subscriptionEndsAt: null,
    stripeSubscriptionId: null,
  });

  logger.info('Store subscription deleted — reverted to free, subscription ID cleared', {
    storeId: store._id.toString(),
    oldStatus,
    newStatus: 'cancelled',
  });
}

// ── Handler 4: invoice.payment_succeeded ──────────────────────────────────────

/**
 * Confirms active status and updates the billing period end after a successful
 * subscription payment.  Also clears any in-progress dunning state so the
 * grace-period timer is fully reset.
 *
 * Only acts on billing_reason 'subscription_cycle' or 'subscription_create'.
 * Other billing reasons (one-off invoices, etc.) are acknowledged without action.
 *
 * Lookup: stripeSubscriptionId → Store
 * Mutations:
 *   subscriptionStatus            ← 'active'
 *   subscriptionEndsAt            ← new Date(lines.data[0].period.end * 1000)
 *   subscriptionDunningStartedAt  ← null   (if previously past_due)
 *   suspensionScheduled           ← false  (if previously past_due)
 *
 * ⚠️  DB failures intentionally re-throw so Stripe retries via HTTP 500.
 */
export async function handleInvoicePaymentSucceeded(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  logger.info('Handling invoice.payment_succeeded', {
    eventId: event.id,
    type: event.type,
    subscriptionId: invoice.subscription as string | null,
    billingReason: invoice.billing_reason,
  });

  // Only handle subscription renewals and initial creates.
  if (
    invoice.billing_reason !== 'subscription_cycle' &&
    invoice.billing_reason !== 'subscription_create'
  ) {
    logger.info('invoice.payment_succeeded — billing_reason not subscription, skipping', {
      eventId: event.id,
      billingReason: invoice.billing_reason,
    });
    return;
  }

  if (!invoice.subscription) {
    logger.warn('invoice.payment_succeeded — no subscription ID on invoice', {
      eventId: event.id,
    });
    return;
  }

  const store = await Store.findOne({
    stripeSubscriptionId: invoice.subscription as string,
  });

  if (!store) {
    logger.warn('invoice.payment_succeeded — no store found for stripeSubscriptionId', {
      eventId: event.id,
      stripeSubscriptionId: invoice.subscription as string,
    });
    return;
  }

  const oldStatus = store.subscriptionStatus;
  const wasPastDue = oldStatus === 'past_due';

  // Derive the new period end from the first invoice line item.
  // This is more precise than the subscription's current_period_end when
  // Stripe prorates a plan change mid-cycle.
  const periodEnd = invoice.lines?.data?.[0]?.period?.end;
  const newEndsAt = periodEnd ? new Date(periodEnd * 1000) : store.subscriptionEndsAt;

  const update: Record<string, unknown> = {
    subscriptionStatus: 'active' as SubscriptionStatus,
    subscriptionEndsAt: newEndsAt,
  };

  // Clear dunning state when recovering from past_due.
  if (wasPastDue) {
    update.subscriptionDunningStartedAt = null;
    update.suspensionScheduled = false;
  }

  // Re-throw DB errors so the controller returns HTTP 500 and Stripe retries.
  await Store.findByIdAndUpdate(store._id, update);

  logger.info('Store subscription payment confirmed — status active', {
    storeId: store._id.toString(),
    oldStatus,
    newStatus: 'active',
    newEndsAt,
    dunningCleared: wasPastDue,
  });
}

// ── Handler 5: invoice.payment_failed ─────────────────────────────────────────

/**
 * Begins the dunning process when a subscription payment fails.
 * Sets the store to past_due and records the failure timestamp.
 *
 * The timestamp is set only on the FIRST failure — subsequent failures for the
 * same billing period leave it unchanged (idempotent on repeated deliveries).
 * The actual suspension is handled by runDunningJob() (Phase 5), not here.
 *
 * Lookup: stripeSubscriptionId → Store
 * Mutations:
 *   subscriptionStatus            ← 'past_due'
 *   subscriptionDunningStartedAt  ← new Date() (only if not already set)
 */
export async function handleInvoicePaymentFailed(event: Stripe.Event): Promise<void> {
  const invoice = event.data.object as Stripe.Invoice;

  logger.info('Handling invoice.payment_failed', {
    eventId: event.id,
    type: event.type,
    subscriptionId: invoice.subscription as string | null,
  });

  if (!invoice.subscription) {
    logger.warn('invoice.payment_failed — no subscription ID on invoice', {
      eventId: event.id,
    });
    return;
  }

  const store = await Store.findOne({
    stripeSubscriptionId: invoice.subscription as string,
  });

  if (!store) {
    logger.warn('invoice.payment_failed — no store found for stripeSubscriptionId', {
      eventId: event.id,
      stripeSubscriptionId: invoice.subscription as string,
    });
    return;
  }

  const oldStatus = store.subscriptionStatus;

  // Set dunningStartedAt only on first failure — preserve original timestamp
  // so the grace period is measured from the first failure, not the latest.
  const update: Record<string, unknown> = {
    subscriptionStatus: 'past_due' as SubscriptionStatus,
  };

  if (!store.subscriptionDunningStartedAt) {
    update.subscriptionDunningStartedAt = new Date();
  }

  await Store.findByIdAndUpdate(store._id, update);

  logger.info('Store subscription payment failed — marked past_due', {
    storeId: store._id.toString(),
    oldStatus,
    newStatus: 'past_due',
    dunningStartedAt: store.subscriptionDunningStartedAt ?? update.subscriptionDunningStartedAt,
    gracePeriodEndsAt: new Date(
      ((store.subscriptionDunningStartedAt ?? (update.subscriptionDunningStartedAt as Date)).getTime()) +
      DUNNING_GRACE_PERIOD_MS
    ),
  });
}

// ── Dunning job (Phase 5) ──────────────────────────────────────────────────────

/**
 * Scheduled job — runs every hour (registered in server.ts).
 * Finds all stores that have been past_due for more than 7 days and
 * promotes them to 'suspended'.
 *
 * This is a pure MongoDB bulk-update — no Stripe API calls — so it is
 * safe to run repeatedly without incurring Stripe rate limits.
 *
 * Exported so it can be imported directly in tests without going through server.ts.
 */
export async function runDunningJob(): Promise<void> {
  const cutoff = new Date(Date.now() - DUNNING_GRACE_PERIOD_MS);

  try {
    const result = await Store.updateMany(
      {
        subscriptionStatus: 'past_due',
        subscriptionDunningStartedAt: { $lt: cutoff },
      },
      {
        $set: {
          subscriptionStatus: 'suspended' as SubscriptionStatus,
          subscriptionDunningStartedAt: null,
        },
      }
    );

    logger.info('Dunning job completed', {
      cutoff,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (err) {
    // Swallow — do not crash the server; next hourly run will retry.
    logger.error('Dunning job failed', {
      timestamp: new Date().toISOString(),
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
  }
}

// ── ensureStripeCustomer helper: look up owner email ──────────────────────────

/**
 * Convenience wrapper: resolves the store owner's email, then calls
 * ensureStripeCustomer.  Used by the admin upgrade endpoint so callers
 * don't have to look up the owner themselves.
 */
export async function ensureStripeCustomerForStore(storeId: string): Promise<string> {
  const store = await Store.findById(storeId).lean();
  if (!store) throw new Error(`Store ${storeId} not found`);

  const owner = await User.findById(store.ownerId).lean();
  if (!owner?.email) throw new Error(`Owner email not found for store ${storeId}`);

  return ensureStripeCustomer(storeId, owner.email);
}
