/**
 * backfill-order-totals.ts
 *
 * Populates the money breakdown on orders written before shipping and tax
 * existed.
 *
 * Before this change an order carried only:
 *     totalAmount = subtotal − discountAmount
 *
 * so the subtotal was never stored and has to be reconstructed:
 *     subtotal      = totalAmount + discountAmount
 *     shippingTotal = 0
 *     taxTotal      = 0
 *     taxLines      = []
 *
 * `totalAmount` is left untouched. It already means "the amount charged", and
 * with zero shipping and zero tax that is still exactly right for these orders —
 * which is why every payment, analytics and reporting figure is unchanged by
 * this migration. Verify that with `--dry-run` before writing.
 *
 * Only touches documents where `subtotal` is MISSING, so it is idempotent and
 * safe to re-run after a partial failure.
 *
 * Usage:
 *   npm run migrate:order-totals -- --dry-run
 *   npm run migrate:order-totals
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  const uri =
    process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const orders = mongoose.connection.collection('orders');

  const total = await orders.countDocuments({});
  const missing = await orders.countDocuments({ subtotal: { $exists: false } });

  console.log(`Orders total:               ${total}`);
  console.log(`Missing money breakdown:    ${missing}`);

  if (missing === 0) {
    console.log('\nNothing to do — every order already has a breakdown.');
    return;
  }

  // Sanity check before writing: the reconstructed subtotal must equal
  // totalAmount + discountAmount for every affected row. If any row disagrees,
  // an order was written by something other than placeOrder and deserves a look
  // before its money is rewritten.
  const [sample] = await orders
    .aggregate([
      { $match: { subtotal: { $exists: false } } },
      {
        $group: {
          _id: null,
          sumTotal: { $sum: '$totalAmount' },
          sumDiscount: { $sum: { $ifNull: ['$discountAmount', 0] } },
          negativeTotals: { $sum: { $cond: [{ $lt: ['$totalAmount', 0] }, 1, 0] } },
        },
      },
    ])
    .toArray();

  const reconstructed = (sample?.sumTotal ?? 0) + (sample?.sumDiscount ?? 0);
  console.log(`\nΣ totalAmount:              ${(sample?.sumTotal ?? 0).toFixed(2)}`);
  console.log(`Σ discountAmount:           ${(sample?.sumDiscount ?? 0).toFixed(2)}`);
  console.log(`→ Σ reconstructed subtotal: ${reconstructed.toFixed(2)}`);

  if ((sample?.negativeTotals ?? 0) > 0) {
    console.warn(`\n⚠️  ${sample.negativeTotals} order(s) have a negative totalAmount — inspect before migrating.`);
  }

  if (dryRun) {
    console.log('\n--dry-run: no documents written.');
    return;
  }

  const result = await orders.updateMany({ subtotal: { $exists: false } }, [
    {
      $set: {
        subtotal: {
          $round: [{ $add: ['$totalAmount', { $ifNull: ['$discountAmount', 0] }] }, 2],
        },
        shippingTotal: 0,
        taxTotal: 0,
        taxLines: [],
      },
    },
  ]);

  console.log(`\nOrders updated:             ${result.modifiedCount}`);

  const remaining = await orders.countDocuments({ subtotal: { $exists: false } });
  if (remaining > 0) {
    console.warn(`\n⚠️  ${remaining} order(s) still missing a breakdown. Re-run or inspect manually.`);
  } else {
    console.log('\n✅ Every order now carries a full money breakdown.');
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
