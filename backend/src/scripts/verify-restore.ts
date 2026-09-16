/**
 * Post-restore verification.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────
 * A restore that "completed successfully" is not a restore that worked. The
 * failure modes are quiet:
 *
 *   • `mongorestore --noIndexRestore`, or an index build that failed partway,
 *     leaves the data intact and the UNIQUE INDEXES missing. `{storeId, email}`
 *     is what stops one tenant's customer colliding with another's, and
 *     `customDomain`'s uniqueness is what stops two stores claiming one host.
 *     Without them the app runs, serves traffic, and silently corrupts.
 *   • A partial restore leaves orders whose store no longer exists, or refunds
 *     pointing at orders that were never restored.
 *   • Point-in-time recovery lands at a different moment than intended, and
 *     nobody measures how much was actually lost until a customer complains.
 *
 * So this asserts the things a human would otherwise assume. Run it against the
 * restored database BEFORE pointing production traffic at it.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *   MONGODB_URI="mongodb+srv://…/restored-db" npm run verify:restore
 *
 * Exits 0 when every check passes, 1 when any FAIL is recorded. Safe to run
 * against production — it only reads.
 */

import mongoose from 'mongoose';

// Models are imported for their schema definitions (index declarations).
import { Store } from '../modules/stores/store.model';
import { User } from '../modules/auth/user.model';
import { Order } from '../modules/orders/order.model';
import { Product } from '../modules/products/product.model';
import { Payment } from '../modules/payments/payment.model';
import { Refund } from '../modules/refunds/refund.model';

type Status = 'PASS' | 'FAIL' | 'WARN';

interface CheckResult {
  status: Status;
  name: string;
  detail: string;
}

const results: CheckResult[] = [];

function record(status: Status, name: string, detail: string): void {
  results.push({ status, name, detail });
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️ ' : '❌';
  console.log(`${icon}  ${name.padEnd(46)} ${detail}`);
}

/** Sample cap for orphan scans — bounded so this stays usable on a large restore. */
const SCAN_LIMIT = 100_000;

/**
 * Counts documents whose foreign key does not resolve in the target collection.
 *
 * `$lookup` rather than loading ids into memory, so this is one round trip and
 * does not depend on the dataset fitting in the process.
 */
async function countOrphans(
  model: mongoose.Model<never>,
  localField: string,
  targetCollection: string
): Promise<number> {
  const [row] = await model.aggregate([
    { $limit: SCAN_LIMIT },
    { $match: { [localField]: { $ne: null } } },
    {
      $lookup: {
        from: targetCollection,
        localField,
        foreignField: '_id',
        as: '__resolved',
      },
    },
    { $match: { __resolved: { $size: 0 } } },
    { $count: 'orphans' },
  ]);
  return row?.orphans ?? 0;
}

// ── 1. The data is present ────────────────────────────────────────────────────

async function checkCollectionsPopulated(): Promise<void> {
  const counts = {
    stores: await Store.estimatedDocumentCount(),
    users: await User.estimatedDocumentCount(),
    products: await Product.estimatedDocumentCount(),
    orders: await Order.estimatedDocumentCount(),
  };

  console.log(
    `\n   counts → stores:${counts.stores} users:${counts.users} ` +
    `products:${counts.products} orders:${counts.orders}\n`
  );

  // A restored production database with no stores or no users is not a restore,
  // it is an empty cluster with the right name — the single most common way a
  // "successful" restore turns out to have pointed at the wrong snapshot.
  if (counts.stores === 0) {
    record('FAIL', 'stores collection populated', 'ZERO stores — wrong snapshot or empty target?');
  } else {
    record('PASS', 'stores collection populated', `${counts.stores} stores`);
  }

  if (counts.users === 0) {
    record('FAIL', 'users collection populated', 'ZERO users — nobody could sign in');
  } else {
    record('PASS', 'users collection populated', `${counts.users} users`);
  }
}

// ── 2. Tenant-isolating indexes survived ──────────────────────────────────────

/**
 * The indexes whose ABSENCE is silently corrupting rather than merely slow.
 *
 * Checked by key shape, not by name, because `mongorestore` and
 * `createIndexes` can produce different auto-generated names for the same key.
 */
const REQUIRED_UNIQUE_INDEXES: Array<{
  collection: string;
  key: Record<string, 1 | -1>;
  why: string;
}> = [
  {
    collection: 'users',
    key: { storeId: 1, email: 1 },
    why: 'one address per tenant; without it two tenants collide on login',
  },
  {
    collection: 'stores',
    key: { slug: 1 },
    why: 'slug resolves a storefront; duplicates make routing non-deterministic',
  },
];

async function checkIndexes(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    record('FAIL', 'index inspection', 'no database handle');
    return;
  }

  for (const required of REQUIRED_UNIQUE_INDEXES) {
    let indexes: Array<{ key: Record<string, unknown>; unique?: boolean }>;
    try {
      indexes = (await db.collection(required.collection).indexes()) as never;
    } catch {
      record('FAIL', `index ${required.collection}`, 'collection missing entirely');
      continue;
    }

    const wanted = JSON.stringify(required.key);
    const match = indexes.find((idx) => JSON.stringify(idx.key) === wanted);

    if (!match) {
      record(
        'FAIL',
        `unique index ${required.collection} ${wanted}`,
        `MISSING — ${required.why}`
      );
    } else if (!match.unique) {
      record(
        'FAIL',
        `unique index ${required.collection} ${wanted}`,
        `present but NOT unique — ${required.why}`
      );
    } else {
      record('PASS', `unique index ${required.collection} ${wanted}`, 'present and unique');
    }
  }
}

// ── 3. Referential integrity across the tenant graph ──────────────────────────

async function checkReferentialIntegrity(): Promise<void> {
  const checks: Array<[string, Promise<number>]> = [
    ['orders → stores', countOrphans(Order as never, 'storeId', 'stores')],
    ['orders → users (customer)', countOrphans(Order as never, 'customerId', 'users')],
    ['products → stores', countOrphans(Product as never, 'storeId', 'stores')],
    ['stores → users (owner)', countOrphans(Store as never, 'ownerId', 'users')],
    ['payments → orders', countOrphans(Payment as never, 'orderId', 'orders')],
    ['refunds → orders', countOrphans(Refund as never, 'orderId', 'orders')],
  ];

  for (const [name, promise] of checks) {
    const orphans = await promise;
    if (orphans > 0) {
      record('FAIL', `referential integrity ${name}`, `${orphans} orphaned document(s)`);
    } else {
      record('PASS', `referential integrity ${name}`, 'no orphans');
    }
  }
}

// ── 4. Money invariants ───────────────────────────────────────────────────────

async function checkMoneyInvariants(): Promise<void> {
  // The refund reservation guarantees refundedTotal <= totalAmount. A restore
  // that interleaved two snapshots, or a partially-applied oplog replay, can
  // break it — and the result is an order that will refund money twice.
  const overRefunded = await Order.countDocuments({
    $expr: { $gt: [{ $ifNull: ['$refundedTotal', 0] }, { $add: ['$totalAmount', 0.005] }] },
  });

  if (overRefunded > 0) {
    record('FAIL', 'no order refunded beyond its total', `${overRefunded} order(s) over-refunded`);
  } else {
    record('PASS', 'no order refunded beyond its total', 'invariant holds');
  }

  const negativeTotals = await Order.countDocuments({ totalAmount: { $lt: 0 } });
  if (negativeTotals > 0) {
    record('FAIL', 'no negative order totals', `${negativeTotals} order(s) negative`);
  } else {
    record('PASS', 'no negative order totals', 'invariant holds');
  }

  const negativeStock = await Product.countDocuments({ stock: { $lt: 0 } });
  if (negativeStock > 0) {
    record('WARN', 'no negative product stock', `${negativeStock} product(s) negative`);
  } else {
    record('PASS', 'no negative product stock', 'invariant holds');
  }
}

// ── 5. How much was actually lost ─────────────────────────────────────────────

async function checkFreshness(): Promise<void> {
  const newest = await Order.findOne().sort({ createdAt: -1 }).select('createdAt').lean();

  if (!newest?.createdAt) {
    record('WARN', 'recovery point (newest order)', 'no orders — cannot measure RPO');
    return;
  }

  const ageMinutes = Math.round((Date.now() - new Date(newest.createdAt).getTime()) / 60_000);
  const detail = `newest order is ${ageMinutes} min old (${new Date(newest.createdAt).toISOString()})`;

  // Not a pass/fail — only the operator knows the intended recovery point. The
  // number is the point: it is the actual data loss, stated out loud, rather
  // than assumed to be whatever the backup schedule implies.
  record('WARN', 'recovery point (newest order)', detail);
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

export async function verifyRestore(): Promise<boolean> {
  // Reset first. `results` is module-level so `record` can stay a plain
  // function, which means a second call would otherwise inherit the first
  // call's failures and could never report success. Irrelevant to the CLI,
  // which runs once, but it made the verifier untestable — and an untestable
  // verifier is exactly the thing this script exists to argue against.
  results.length = 0;

  await checkCollectionsPopulated();
  await checkIndexes();
  await checkReferentialIntegrity();
  await checkMoneyInvariants();
  await checkFreshness();

  const failures = results.filter((r) => r.status === 'FAIL');
  const warnings = results.filter((r) => r.status === 'WARN');

  console.log('\n' + '─'.repeat(78));
  console.log(
    `   ${results.filter((r) => r.status === 'PASS').length} passed · ` +
    `${warnings.length} warning(s) · ${failures.length} failed`
  );

  if (failures.length > 0) {
    console.log('\n   ❌  DO NOT send production traffic to this database:\n');
    failures.forEach((f) => console.log(`       • ${f.name} — ${f.detail}`));
  } else {
    console.log('\n   ✅  Restore verified. Review the warnings above before cutting over.');
  }
  console.log('─'.repeat(78) + '\n');

  return failures.length === 0;
}

/* istanbul ignore next — CLI wrapper, exercised by the drill rather than unit tests */
if (require.main === module) {
  (async () => {
    const { config } = await import('../config/index');
    console.log(`\n🔍  Verifying restore at ${config.MONGODB_URI.replace(/:([^@]+)@/, ':***@')}\n`);

    await mongoose.connect(config.MONGODB_URI);
    let ok = false;
    try {
      ok = await verifyRestore();
    } finally {
      await mongoose.disconnect();
    }
    process.exit(ok ? 0 : 1);
  })().catch((err) => {
    console.error('\n❌  Verification could not run:', (err as Error).message, '\n');
    process.exit(1);
  });
}
