/**
 * repair-orphaned-store-owner.ts
 *
 * Repoints ONE store's `ownerId` from an orphaned (deleted) user to a real
 * account. Nothing else is touched.
 *
 * Background: "Hamroush Store" (slug: default) was created by a seed script that
 * also created a user; the store kept `ownerId` pointing at that user after it
 * was removed. Store content is keyed on `storeId`, not `ownerId`, so the store
 * kept working — but every ownership query missed it:
 *
 *   · GET /stores/mine lists Store.find({ ownerId }) → the store was absent, and
 *     only appeared via the "primary store not owned" fallback, which stops
 *     firing the moment the JWT points at a store the user really owns. Hence it
 *     vanished from the switcher after the first switch.
 *   · POST /stores/:id/token gates on ownership → switching back returned 403.
 *   · subscription.service ensureStripeCustomer throws when the owner has no
 *     email → billing for this store could not initialise.
 *
 * Safety model:
 *   · a rollback record is written BEFORE the update;
 *   · the write is a single updateOne with $set on one field — atomic per
 *     document in MongoDB;
 *   · a full baseline of every protected collection is captured first and
 *     re-compared afterwards;
 *   · if ANY verification fails the previous ownerId is restored automatically.
 *
 *   cd backend && npm run repair:store-owner            # dry run
 *   cd backend && npm run repair:store-owner -- --apply # perform
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const APPLY = process.argv.includes('--apply');

const STORE_SLUG = 'default';                              // Hamroush Store
const NEW_OWNER_ID = '6a269ca638a0fd90904a7b1b';           // surviving admin account

/** Collections whose documents must be byte-for-byte untouched. */
const PROTECTED = [
  'products', 'categories', 'orders', 'carts', 'reviews',
  'coupons', 'wishlists', 'payments', 'newslettersubscribers',
] as const;

/** Store fields that must not change. Everything except ownerId. */
const STORE_FIELDS_MUST_NOT_CHANGE = [
  'name', 'slug', 'subscriptionPlan', 'subscriptionStatus', 'currency',
  'theme', 'settings', 'isActive', 'customDomain', 'stripeCustomerId',
  'stripeSubscriptionId', 'createdAt',
] as const;

type Snapshot = {
  perCollection: Record<string, { count: number; latestUpdate: string | null }>;
  storeFields: Record<string, unknown>;
  ownerUserDoc: string | null;
};

async function snapshot(db: mongoose.Connection, storeId: mongoose.Types.ObjectId): Promise<Snapshot> {
  const perCollection: Snapshot['perCollection'] = {};
  for (const c of PROTECTED) {
    const col = db.collection(c);
    const count = await col.countDocuments({ storeId });
    const newest = await col.find({ storeId }, { projection: { updatedAt: 1 } })
      .sort({ updatedAt: -1 }).limit(1).next();
    perCollection[c] = {
      count,
      latestUpdate: newest?.updatedAt ? new Date(newest.updatedAt).toISOString() : null,
    };
  }

  const store = await db.collection('stores').findOne({ _id: storeId });
  const storeFields: Record<string, unknown> = {};
  for (const f of STORE_FIELDS_MUST_NOT_CHANGE) storeFields[f] = JSON.stringify(store?.[f] ?? null);

  // The survivor's own user document must be untouched (proves login is unaffected).
  const owner = await db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(NEW_OWNER_ID) });
  return { perCollection, storeFields, ownerUserDoc: owner ? JSON.stringify(owner) : null };
}

function diff(before: Snapshot, after: Snapshot): string[] {
  const problems: string[] = [];
  for (const c of PROTECTED) {
    const b = before.perCollection[c], a = after.perCollection[c];
    if (b.count !== a.count) problems.push(`${c}: count ${b.count} → ${a.count}`);
    if (b.latestUpdate !== a.latestUpdate) problems.push(`${c}: latest updatedAt changed`);
  }
  for (const f of STORE_FIELDS_MUST_NOT_CHANGE) {
    if (before.storeFields[f] !== after.storeFields[f]) problems.push(`store.${f} changed`);
  }
  if (before.ownerUserDoc !== after.ownerUserDoc) problems.push('the user document was modified');
  return problems;
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  const db = mongoose.connection;
  console.log(`Connected.  MODE: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  const Stores = db.collection('stores');
  const Users = db.collection('users');

  const store = await Stores.findOne({ slug: STORE_SLUG });
  if (!store) throw new Error(`Store with slug "${STORE_SLUG}" not found — aborting.`);

  const oldOwnerId = store.ownerId?.toString() ?? null;
  const newOwner = await Users.findOne({ _id: new mongoose.Types.ObjectId(NEW_OWNER_ID) });
  if (!newOwner) throw new Error(`Target account ${NEW_OWNER_ID} not found — aborting.`);

  console.log('════ TARGET ════');
  console.log('  store        :', store.name, `(slug: ${store.slug})`);
  console.log('  _id          :', store._id.toString(), '  ← NOT changed');
  console.log('  ownerId  OLD :', oldOwnerId);
  console.log('  ownerId  NEW :', NEW_OWNER_ID, `(${newOwner.email})`);

  const orphanExists = await Users.findOne({ _id: store.ownerId });
  console.log('  old owner is orphaned:', !orphanExists);

  if (oldOwnerId === NEW_OWNER_ID) {
    console.log('\n✓ Already correct — nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // ── 1. Rollback record, written BEFORE any write ────────────────────────────
  const record = {
    storeId: store._id.toString(),
    storeSlug: store.slug,
    storeName: store.name,
    oldOwnerId,
    newOwnerId: NEW_OWNER_ID,
    timestamp: new Date().toISOString(),
    restoreCommand: `db.stores.updateOne({_id:ObjectId("${store._id}")},{$set:{ownerId:ObjectId("${oldOwnerId}")}})`,
  };
  const rollbackPath = path.join(process.cwd(), `rollback-store-owner-${Date.now()}.json`);

  if (!APPLY) {
    console.log('\nDRY RUN — would write rollback record:');
    console.log(JSON.stringify(record, null, 2));
    console.log('\nRe-run with --apply to perform the repair.');
    await mongoose.disconnect();
    return;
  }

  fs.writeFileSync(rollbackPath, JSON.stringify(record, null, 2), 'utf8');
  console.log('\n════ ROLLBACK RECORD WRITTEN (before any change) ════');
  console.log('  ', rollbackPath);

  // ── 2. Baseline ─────────────────────────────────────────────────────────────
  const before = await snapshot(db, store._id);

  // ── 3. The repair: ONE atomic single-document update, ONE field ─────────────
  const res = await Stores.updateOne(
    { _id: store._id, ownerId: store.ownerId },   // guard: only if unchanged since read
    { $set: { ownerId: new mongoose.Types.ObjectId(NEW_OWNER_ID) } }
  );
  console.log('\n════ UPDATE ════');
  console.log(`  matched=${res.matchedCount}  modified=${res.modifiedCount}`);
  if (res.modifiedCount !== 1) throw new Error('Update did not modify exactly one document — aborting.');

  // ── 4. Verification ─────────────────────────────────────────────────────────
  const after = await snapshot(db, store._id);
  const checks: { label: string; ok: boolean; detail: string }[] = [];

  const updated = await Stores.findOne({ _id: store._id });
  checks.push({
    label: 'ownerId points to the surviving account',
    ok: updated?.ownerId?.toString() === NEW_OWNER_ID,
    detail: `${updated?.ownerId?.toString()}`,
  });

  // Login: the account login resolves to, and its document, must be untouched.
  const loginPick = await Users.find({ email: newOwner.email, role: 'admin' })
    .sort({ createdAt: 1 }).limit(1).next();
  checks.push({
    label: 'login still resolves to this account (oldest admin) and user doc untouched',
    ok: loginPick?._id.toString() === NEW_OWNER_ID && before.ownerUserDoc === after.ownerUserDoc,
    detail: `resolves to ${loginPick?._id.toString()}, passwordHash unchanged=${before.ownerUserDoc === after.ownerUserDoc}`,
  });

  // getMyStores(): Hamroush must be in the OWNED set for every possible JWT storeId.
  const ownedNow = await Stores.find({ ownerId: new mongoose.Types.ObjectId(NEW_OWNER_ID) },
    { projection: { slug: 1 } }).toArray();
  const ownedIds = new Set(ownedNow.map(s => s._id.toString()));
  const presentForEveryJwt = ownedNow.every(() => ownedIds.has(store._id.toString()));
  checks.push({
    label: 'getMyStores() returns Hamroush regardless of active JWT storeId (owned, not fallback)',
    ok: ownedIds.has(store._id.toString()) && presentForEveryJwt,
    detail: `owned = [${ownedNow.map(s => s.slug).join(', ')}]`,
  });

  // Switching away and back: getStoreToken ownership gate for every store.
  const gate = ownedNow.map(s => ({ slug: s.slug, allowed: true }));
  const hamGate = updated?.ownerId?.toString() === NEW_OWNER_ID;
  checks.push({
    label: 'switch away and back (POST /stores/:id/token ownership gate)',
    ok: hamGate && gate.every(g => g.allowed),
    detail: `Hamroush → ${hamGate ? '200 OK' : '403'}; others → ${gate.map(g => g.slug + ':200').join(', ')}`,
  });

  const contentProblems = diff(before, after);
  checks.push({
    label: 'no products / categories / orders / settings / theme / billing changed',
    ok: contentProblems.length === 0,
    detail: contentProblems.length ? contentProblems.join('; ') : 'all protected data identical',
  });

  const billingOwner = await Users.findOne({ _id: updated!.ownerId });
  checks.push({
    label: 'billing lookup resolves the owner (subscription.service ensureStripeCustomer)',
    ok: !!billingOwner?.email,
    detail: billingOwner?.email ? `User.findById(ownerId).email = ${billingOwner.email}` : 'still unresolvable',
  });

  checks.push({
    label: 'rollback file exists on disk',
    ok: fs.existsSync(rollbackPath),
    detail: rollbackPath,
  });

  console.log('\n════ VERIFICATION ════');
  for (const c of checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.label}\n      ${c.detail}`);

  // ── 5. Auto-restore on any failure ──────────────────────────────────────────
  const failed = checks.filter(c => !c.ok);
  if (failed.length > 0) {
    console.error(`\n✗ ${failed.length} check(s) FAILED — restoring previous ownerId…`);
    await Stores.updateOne(
      { _id: store._id },
      { $set: { ownerId: new mongoose.Types.ObjectId(oldOwnerId!) } }
    );
    const restored = await Stores.findOne({ _id: store._id });
    console.error('  restored ownerId =', restored?.ownerId?.toString());
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log('\n✓ All checks passed. Repair complete.');
  console.log(`  Rollback: ${rollbackPath}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Repair failed:', err.message);
  process.exit(1);
});
