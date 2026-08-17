/**
 * backfill-trial-ends-at.ts
 *
 * Populates `trialEndsAt` on stores written before the field existed.
 *
 * ── Why a grace window rather than createdAt + 7 days ────────────────────────
 * Trial state used to live only in the browser (useTrialStatus.ts computed
 * `createdAt + 7 days`), so the server never enforced it. Enabling enforcement
 * with a naive `createdAt + 7d` backfill would drop every store older than a
 * week onto the free tier the instant this deploys — including stores whose
 * owners have never been told the rules changed.
 *
 * Instead every un-migrated store that is not already on a paid plan gets a
 * FRESH window measured from the moment this script runs. That gives you a
 * documented period to email affected merchants before entitlement narrows,
 * and it makes the rollout non-events for anyone actively using the product.
 *
 * Stores already on a paid active plan get `trialEndsAt: null` — they are not
 * trialing, and leaving the field absent would keep reporting them as
 * "un-migrated" forever.
 *
 * Only touches documents where the field is MISSING. An existing deadline is
 * never overwritten, so this is safe to run repeatedly and safe to re-run after
 * a partial failure.
 *
 * Usage:
 *   npm run migrate:trial-ends-at                 # 14-day grace (default)
 *   npm run migrate:trial-ends-at -- --days=30    # custom grace window
 *   npm run migrate:trial-ends-at -- --dry-run    # report only, write nothing
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_DAYS = 14;

/** Statuses that mean "this store is paying and is not on a trial". */
const PAID_STATUSES = ['active', 'past_due'];

function parseArgs(argv: string[]): { graceDays: number; dryRun: boolean } {
  const dryRun = argv.includes('--dry-run');

  const daysArg = argv.find((a) => a.startsWith('--days='));
  const parsed = daysArg ? Number.parseInt(daysArg.split('=')[1], 10) : DEFAULT_GRACE_DAYS;

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--days must be a non-negative integer (got "${daysArg}")`);
  }

  return { graceDays: parsed, dryRun };
}

async function run(): Promise<void> {
  const { graceDays, dryRun } = parseArgs(process.argv.slice(2));

  const uri =
    process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const stores = mongoose.connection.collection('stores');

  const total = await stores.countDocuments({});
  const missing = await stores.countDocuments({ trialEndsAt: { $exists: false } });

  console.log(`Stores total:               ${total}`);
  console.log(`Missing trialEndsAt:        ${missing}`);

  if (missing === 0) {
    console.log('\nNothing to do — every store already has trialEndsAt.');
    return;
  }

  // Two disjoint groups, both filtered on the field being absent so an existing
  // value is never clobbered.
  const paidFilter = {
    trialEndsAt: { $exists: false },
    subscriptionStatus: { $in: PAID_STATUSES },
    subscriptionPlan: { $ne: 'free' },
  };
  const trialFilter = {
    trialEndsAt: { $exists: false },
    $nor: [{ subscriptionStatus: { $in: PAID_STATUSES }, subscriptionPlan: { $ne: 'free' } }],
  };

  const paidCount = await stores.countDocuments(paidFilter);
  const trialCount = await stores.countDocuments(trialFilter);

  const deadline = new Date(Date.now() + graceDays * DAY_MS);

  console.log(`  → on a paid plan:         ${paidCount}  (trialEndsAt = null)`);
  console.log(`  → given a grace window:   ${trialCount}  (trialEndsAt = ${deadline.toISOString()})`);
  console.log(`\nGrace window:               ${graceDays} day(s) from now`);

  if (dryRun) {
    console.log('\n--dry-run: no documents written.');
    return;
  }

  const paidResult = await stores.updateMany(paidFilter, { $set: { trialEndsAt: null } });
  const trialResult = await stores.updateMany(trialFilter, { $set: { trialEndsAt: deadline } });

  console.log(`\nPaid stores updated:        ${paidResult.modifiedCount}`);
  console.log(`Trial stores updated:       ${trialResult.modifiedCount}`);

  const remaining = await stores.countDocuments({ trialEndsAt: { $exists: false } });
  if (remaining > 0) {
    // Not fatal — re-running is safe and idempotent — but it means a document
    // matched neither filter, which would be a data-shape surprise worth seeing.
    console.warn(`\n⚠️  ${remaining} store(s) still missing trialEndsAt. Re-run or inspect manually.`);
  } else {
    console.log('\n✅ Every store now has an explicit trialEndsAt.');
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
