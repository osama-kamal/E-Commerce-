/**
 * drop-payment-intent-unique-index.ts
 *
 * Removes the obsolete unique index on payments.stripePaymentIntentId.
 *
 * Why: Stripe reuses a single PaymentIntent across card retries, so one intent
 * legitimately emits several events (payment_intent.payment_failed, then
 * payment_intent.succeeded after the customer re-confirms with another card).
 * With `unique: true` on stripePaymentIntentId, the success write failed with
 * E11000, the error was swallowed by the webhook handler's outer catch, and the
 * order stayed 'pending' even though the card had been charged.
 *
 * Idempotency is enforced by the unique index on `stripeEventId` instead —
 * one row per Stripe event, which is the correct granularity.
 *
 * Mongoose creates missing indexes on boot but never drops obsolete ones, so
 * removing `unique: true` from the schema is not enough for an existing
 * database. This script closes that gap.
 *
 * Safe to run repeatedly.
 *
 * Run once per environment:
 *   cd backend && npx ts-node src/scripts/drop-payment-intent-unique-index.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const payments = mongoose.connection.collection('payments');

  // ── 1. Drop the unique index if present ──────────────────────────────────
  try {
    await payments.dropIndex('stripePaymentIntentId_1');
    console.log('✓ Dropped unique index: stripePaymentIntentId_1');
  } catch (e: unknown) {
    const err = e as { code?: number; codeName?: string };
    if (err?.codeName === 'IndexNotFound' || err?.code === 27) {
      console.log('  Index not found (already dropped): stripePaymentIntentId_1');
    } else {
      throw e;
    }
  }

  // ── 2. Recreate it as a plain, non-unique lookup index ───────────────────
  await payments.createIndex({ stripePaymentIntentId: 1 }, { unique: false });
  console.log('✓ Recreated stripePaymentIntentId as a non-unique index');

  // ── 3. Confirm stripeEventId is still uniquely indexed ───────────────────
  const indexes = await payments.indexes();
  const eventIdx = indexes.find((i) => i.name === 'stripeEventId_1');
  if (eventIdx?.unique) {
    console.log('✓ stripeEventId_1 is unique — idempotency guard intact');
  } else {
    console.log('! stripeEventId_1 is NOT unique — creating it now');
    await payments.createIndex({ stripeEventId: 1 }, { unique: true });
    console.log('✓ Created unique index on stripeEventId');
  }

  // ── 4. Report orders that may be stuck from the old behaviour ────────────
  // An order left 'pending' while a succeeded payment exists for it was very
  // likely hit by this bug and needs manual review.
  const stuck = await mongoose.connection
    .collection('orders')
    .aggregate([
      { $match: { status: 'pending' } },
      {
        $lookup: {
          from: 'payments',
          localField: '_id',
          foreignField: 'orderId',
          as: 'pmts',
        },
      },
      { $match: { 'pmts.status': 'succeeded' } },
      { $project: { _id: 1, totalAmount: 1, createdAt: 1 } },
    ])
    .toArray();

  if (stuck.length > 0) {
    console.log(`\n⚠️  ${stuck.length} order(s) are 'pending' despite a succeeded payment.`);
    console.log('   These were likely blocked by the old unique index. Review and advance manually:');
    stuck.forEach((o) => console.log(`   • ${o._id}  amount=${o.totalAmount}  created=${o.createdAt}`));
  } else {
    console.log('\n✓ No orders found stuck pending with a succeeded payment.');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
