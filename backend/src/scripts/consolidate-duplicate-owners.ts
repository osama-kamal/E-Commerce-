/**
 * consolidate-duplicate-owners.ts
 *
 * Repairs accounts that were split across several User documents sharing one
 * email address.
 *
 * How the split happened: the POST /onboarding guard used to inspect ONE
 * arbitrary admin row, so a repeat signup could mint another admin user with the
 * same address (permitted — the unique index is { storeId, email }, not
 * { email }). Each signup produced an independent account owning one store.
 *
 * Why that is broken: auth.service.login resolves globally and selects the
 * OLDEST admin for the address, comparing only that one password hash. Every
 * later account becomes unreachable — its password is rejected, and the stores
 * it owns disappear from GET /stores/mine, which hides the store switcher
 * (AdminLayout requires myStores.length > 1).
 *
 * What this does: for each email with more than one admin account, it picks the
 * SURVIVOR — the oldest admin, i.e. the one login actually reaches, so the
 * password that currently works keeps working — and re-points every store owned
 * by the duplicates to that survivor.
 *
 * What it deliberately does NOT do:
 *   · it never deletes or deactivates a user document. The duplicates are left
 *     in place, owning nothing. Nothing is destroyed, and the change can be
 *     undone from the rollback file it writes.
 *   · it never touches passwords, products, orders, carts or settings.
 *   · it never reassigns a store whose owner is already the survivor.
 *
 * Run with --apply to write. Without it the script only reports.
 *
 *   cd backend && npm run repair:owners            # dry run
 *   cd backend && npm run repair:owners -- --apply # perform the fix
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const APPLY = process.argv.includes('--apply');

interface RollbackEntry {
  storeId: string;
  slug: string;
  previousOwnerId: string;
  newOwnerId: string;
}

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log(`Connected.  MODE: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  const Users = mongoose.connection.collection('users');
  const Stores = mongoose.connection.collection('stores');

  // Emails with more than one admin-role account.
  const groups = await Users.aggregate<{ _id: string; ids: mongoose.Types.ObjectId[] }>([
    { $match: { role: 'admin' } },
    { $group: { _id: '$email', n: { $sum: 1 }, ids: { $push: '$_id' } } },
    { $match: { n: { $gt: 1 } } },
  ]).toArray();

  if (groups.length === 0) {
    console.log('✓ No email has more than one admin account — nothing to consolidate.');
    await mongoose.disconnect();
    return;
  }

  const rollback: RollbackEntry[] = [];

  for (const group of groups) {
    // Oldest admin wins: that is the account auth.service.login selects, so the
    // password the user currently signs in with keeps working.
    const accounts = await Users.find(
      { _id: { $in: group.ids } },
      { projection: { createdAt: 1 } }
    ).sort({ createdAt: 1 }).toArray();

    const survivor = accounts[0];
    const duplicates = accounts.slice(1);

    console.log(`── ${group._id}`);
    console.log(`   survivor  : ${survivor._id}  (oldest — the account login reaches)`);
    console.log(`   duplicates: ${duplicates.length}`);

    const orphanedStores = await Stores.find(
      { ownerId: { $in: duplicates.map(d => d._id) } },
      { projection: { slug: 1, ownerId: 1 } }
    ).toArray();

    if (orphanedStores.length === 0) {
      console.log('   no stores to move.\n');
      continue;
    }

    for (const s of orphanedStores) {
      console.log(`     move store "${s.slug}"  ${s.ownerId}  ->  ${survivor._id}`);
      rollback.push({
        storeId: s._id.toString(),
        slug: String(s.slug),
        previousOwnerId: s.ownerId.toString(),
        newOwnerId: survivor._id.toString(),
      });
    }

    if (APPLY) {
      const res = await Stores.updateMany(
        { ownerId: { $in: duplicates.map(d => d._id) } },
        { $set: { ownerId: survivor._id } }
      );
      console.log(`   ✓ moved ${res.modifiedCount} store(s).`);
    }

    // Post-state preview: what GET /stores/mine will now return for the survivor.
    const ownedAfter = APPLY
      ? await Stores.countDocuments({ ownerId: survivor._id })
      : (await Stores.countDocuments({ ownerId: survivor._id })) + orphanedStores.length;
    console.log(`   → /stores/mine will return ${ownedAfter} owned store(s); switcher shows at > 1.\n`);
  }

  if (rollback.length > 0) {
    const file = path.join(process.cwd(), `owner-consolidation-rollback-${Date.now()}.json`);
    if (APPLY) {
      fs.writeFileSync(file, JSON.stringify(rollback, null, 2), 'utf8');
      console.log(`Rollback map written to:\n  ${file}`);
      console.log('  Each entry records the store and its previous ownerId.');
    } else {
      console.log(`DRY RUN — ${rollback.length} store(s) would move. Re-run with --apply to perform it.`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(err => {
  console.error('Consolidation failed:', err);
  process.exit(1);
});
