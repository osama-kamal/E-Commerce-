/**
 * backfill-payment-status.ts
 *
 * Populates `paymentStatus` and `refundedTotal` on orders written before
 * payment became its own axis.
 *
 * ── Why the field exists ──────────────────────────────────────────────────────
 * `status` conflated fulfilment and money, and both of its end states were
 * terminal. There was no way to express "delivered AND refunded" — which is the
 * normal shape of a return — so refunds had nowhere to live.
 *
 * ── How each order is classified ──────────────────────────────────────────────
 * Most reliable evidence first:
 *
 *   1. a succeeded Payment row exists for the order  → paid
 *   2. fulfilment reached processing/shipped/delivered → paid
 *      (the order was advanced past payment, which for an online order means it
 *      was charged, and for cash-on-delivery means the merchant accepted it)
 *   3. anything else — pending or cancelled           → unpaid
 *
 * Rule 2 is a judgement call, and it is the conservative one: marking a
 * genuinely-paid order `unpaid` would make it unrefundable, which is worse than
 * the reverse (a merchant can always see the refund attempt fail at the
 * gateway). Cancelled orders are treated as unpaid because the existing
 * cancellation path never took money.
 *
 * `refundedTotal` and `refundedTaxTotal` are 0 for every historical order: no refund could be issued
 * before this feature existed.
 *
 * Only touches documents where `paymentStatus` is MISSING, so it is idempotent.
 *
 * Usage:
 *   npm run migrate:payment-status -- --dry-run
 *   npm run migrate:payment-status
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const PAID_FULFILMENT = ['processing', 'shipped', 'delivered'];

async function run(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const uri =
    process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const orders = mongoose.connection.collection('orders');
  const payments = mongoose.connection.collection('payments');

  const total = await orders.countDocuments({});
  const missing = await orders.countDocuments({ paymentStatus: { $exists: false } });

  console.log(`Orders total:               ${total}`);
  console.log(`Missing paymentStatus:      ${missing}`);

  if (missing === 0) {
    console.log('\nNothing to do — every order already has a payment status.');
    return;
  }

  // Orders with hard evidence of a successful charge.
  const paidOrderIds = await payments.distinct('orderId', { status: 'succeeded' });
  console.log(`Orders with a succeeded payment record: ${paidOrderIds.length}`);

  const paidFilter = {
    paymentStatus: { $exists: false },
    $or: [
      { _id: { $in: paidOrderIds } },
      { status: { $in: PAID_FULFILMENT } },
    ],
  };
  const unpaidFilter = {
    paymentStatus: { $exists: false },
    _id: { $nin: paidOrderIds },
    status: { $nin: PAID_FULFILMENT },
  };

  const paidCount = await orders.countDocuments(paidFilter);
  const unpaidCount = await orders.countDocuments(unpaidFilter);

  console.log(`  → paid:                   ${paidCount}`);
  console.log(`  → unpaid:                 ${unpaidCount}`);

  if (paidCount + unpaidCount !== missing) {
    // Every un-migrated order must land in exactly one bucket. A mismatch means
    // a document shape nobody expected — worth seeing before rewriting money.
    console.warn(
      `\n⚠️  Bucket totals (${paidCount + unpaidCount}) do not match the ` +
      `un-migrated count (${missing}). Inspect before running without --dry-run.`
    );
  }

  if (dryRun) {
    console.log('\n--dry-run: no documents written.');
    return;
  }

  const paidResult = await orders.updateMany(paidFilter, {
    $set: { paymentStatus: 'paid', refundedTotal: 0, refundedTaxTotal: 0 },
  });
  const unpaidResult = await orders.updateMany(unpaidFilter, {
    $set: { paymentStatus: 'unpaid', refundedTotal: 0, refundedTaxTotal: 0 },
  });

  console.log(`\nMarked paid:                ${paidResult.modifiedCount}`);
  console.log(`Marked unpaid:              ${unpaidResult.modifiedCount}`);

  const remaining = await orders.countDocuments({ paymentStatus: { $exists: false } });
  if (remaining > 0) {
    console.warn(`\n⚠️  ${remaining} order(s) still missing paymentStatus. Re-run or inspect.`);
  } else {
    console.log('\n✅ Every order now has an explicit payment status.');
  }
}

run()
  .catch((err) => {
    console.error('\n❌ Migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log('Disconnected.');
  });
