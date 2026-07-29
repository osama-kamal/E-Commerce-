/**
 * Regression tests for subscription cancellation and the sparse unique index.
 *
 * store.model.ts documents the hazard explicitly:
 *
 *   "`null` is a real BSON value — sparse indexes still index it and will throw
 *    E11000 on the second store created without a Stripe customer."
 *
 * handleSubscriptionDeleted then wrote exactly that: `stripeSubscriptionId: null`.
 * The FIRST cancellation succeeded; the SECOND collided on the sparse unique
 * index. That E11000 was swallowed by handleWebhook's outer catch, Stripe got a
 * 200 and never retried — so the second store kept its paid plan forever after
 * cancelling, with no alert. Silent revenue leak.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Stripe from 'stripe';

import {
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
} from '../../src/modules/payments/subscription.service';
import { Store } from '../../src/modules/stores/store.model';

jest.mock('../../src/config/stripe', () => ({
  stripe: { customers: { create: jest.fn() } },
}));

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Ensure the sparse unique indexes actually exist in the test DB, otherwise
  // this suite would pass for the wrong reason.
  await Store.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Store.deleteMany({});
});

async function makeSubscribedStore(slug: string, subId: string) {
  return Store.create({
    name: slug, slug, ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active',
    stripeCustomerId: `cus_${slug}`,
    stripeSubscriptionId: subId,
    subscriptionEndsAt: new Date(Date.now() + 30 * 86_400_000),
  });
}

const deletedEvent = (subId: string) =>
  ({ id: `evt_del_${subId}`, type: 'customer.subscription.deleted',
     data: { object: { id: subId } } } as unknown as Stripe.Event);

// ── The bug ─────────────────────────────────────────────────────────────────

describe('customer.subscription.deleted', () => {
  it('reverts the first cancelling store to free', async () => {
    const store = await makeSubscribedStore('sub-a', 'sub_a');

    await handleSubscriptionDeleted(deletedEvent('sub_a'));

    const after = await Store.findById(store._id).lean();
    expect(after!.subscriptionPlan).toBe('free');
    expect(after!.subscriptionStatus).toBe('cancelled');
  });

  it('reverts a SECOND cancelling store to free (sparse-index collision)', async () => {
    const a = await makeSubscribedStore('sub-a', 'sub_a');
    const b = await makeSubscribedStore('sub-b', 'sub_b');

    await handleSubscriptionDeleted(deletedEvent('sub_a'));
    await handleSubscriptionDeleted(deletedEvent('sub_b'));

    const afterA = await Store.findById(a._id).lean();
    const afterB = await Store.findById(b._id).lean();

    expect(afterA!.subscriptionPlan).toBe('free');
    // This is the one that previously stayed on 'pro' forever.
    expect(afterB!.subscriptionPlan).toBe('free');
    expect(afterB!.subscriptionStatus).toBe('cancelled');
  });

  it('handles a third cancellation too', async () => {
    const stores = await Promise.all([
      makeSubscribedStore('sub-a', 'sub_a'),
      makeSubscribedStore('sub-b', 'sub_b'),
      makeSubscribedStore('sub-c', 'sub_c'),
    ]);

    await handleSubscriptionDeleted(deletedEvent('sub_a'));
    await handleSubscriptionDeleted(deletedEvent('sub_b'));
    await handleSubscriptionDeleted(deletedEvent('sub_c'));

    for (const s of stores) {
      const after = await Store.findById(s._id).lean();
      expect(after!.subscriptionPlan).toBe('free');
    }
  });

  it('unsets stripeSubscriptionId rather than storing null', async () => {
    const store = await makeSubscribedStore('sub-a', 'sub_a');
    await handleSubscriptionDeleted(deletedEvent('sub_a'));

    const raw = await Store.collection.findOne({ _id: store._id });
    // Field must be ABSENT — a stored null re-triggers the index collision.
    expect(Object.prototype.hasOwnProperty.call(raw!, 'stripeSubscriptionId')).toBe(false);
  });

  it('clears the billing period end', async () => {
    const store = await makeSubscribedStore('sub-a', 'sub_a');
    await handleSubscriptionDeleted(deletedEvent('sub_a'));

    const after = await Store.findById(store._id).lean();
    expect(after!.subscriptionEndsAt ?? null).toBeNull();
  });

  it('is a no-op when no store matches the subscription', async () => {
    await makeSubscribedStore('sub-a', 'sub_a');
    await expect(handleSubscriptionDeleted(deletedEvent('sub_unknown'))).resolves.toBeUndefined();

    const after = await Store.findOne({ slug: 'sub-a' }).lean();
    expect(after!.subscriptionPlan).toBe('pro');
  });
});

// ── The same hazard via subscription.updated -> canceled ────────────────────

describe('customer.subscription.updated (canceled)', () => {
  const canceledEvent = (subId: string) =>
    ({ id: `evt_upd_${subId}`, type: 'customer.subscription.updated',
       data: { object: { id: subId, status: 'canceled', items: { data: [] } } } } as unknown as Stripe.Event);

  it('reverts two stores in sequence without colliding', async () => {
    const a = await makeSubscribedStore('sub-a', 'sub_a');
    const b = await makeSubscribedStore('sub-b', 'sub_b');

    await handleSubscriptionUpdated(canceledEvent('sub_a'));
    await handleSubscriptionUpdated(canceledEvent('sub_b'));

    expect((await Store.findById(a._id).lean())!.subscriptionPlan).toBe('free');
    expect((await Store.findById(b._id).lean())!.subscriptionPlan).toBe('free');
  });

  it('preserves the plan when a subscription goes past_due', async () => {
    const pastDue = {
      id: 'evt_pd', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_a', status: 'past_due', items: { data: [] } } },
    } as unknown as Stripe.Event;

    const store = await makeSubscribedStore('sub-a', 'sub_a');
    await handleSubscriptionUpdated(pastDue);

    const after = await Store.findById(store._id).lean();
    expect(after!.subscriptionStatus).toBe('past_due');
    expect(after!.subscriptionPlan).toBe('pro'); // deliberately preserved
  });
});
