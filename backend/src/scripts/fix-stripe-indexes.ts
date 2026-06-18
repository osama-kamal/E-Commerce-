/**
 * fix-stripe-indexes.ts
 *
 * Fixes the E11000 duplicate key error on stripeCustomerId / stripeSubscriptionId.
 *
 * The problem: these fields have `default: null` which stores BSON null,
 * but sparse unique indexes still index null — causing a duplicate key error
 * when a second store is created without a Stripe customer.
 *
 * This script:
 *   1. Drops the bad indexes
 *   2. Updates all documents that have null → $unset (removes the field entirely)
 *   3. Recreates the indexes as proper sparse unique indexes (Mongoose will also
 *      do this on next server start, but we do it here to be explicit)
 *
 * Run once:
 *   cd backend && npx ts-node src/scripts/fix-stripe-indexes.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const stores = mongoose.connection.collection('stores');

  // ── 1. Drop the bad indexes (ignore error if they don't exist) ─────────────
  for (const indexName of ['stripeCustomerId_1', 'stripeSubscriptionId_1']) {
    try {
      await stores.dropIndex(indexName);
      console.log(`✓ Dropped index: ${indexName}`);
    } catch (e: any) {
      if (e?.codeName === 'IndexNotFound' || e?.code === 27) {
        console.log(`  Index not found (already dropped): ${indexName}`);
      } else {
        throw e;
      }
    }
  }

  // ── 2. Unset null values so documents become truly absent ──────────────────
  //    Sparse indexes skip absent fields but NOT null fields.
  const r1 = await stores.updateMany(
    { stripeCustomerId: null },
    { $unset: { stripeCustomerId: '' } }
  );
  console.log(`✓ Unset stripeCustomerId from ${r1.modifiedCount} stores`);

  const r2 = await stores.updateMany(
    { stripeSubscriptionId: null },
    { $unset: { stripeSubscriptionId: '' } }
  );
  console.log(`✓ Unset stripeSubscriptionId from ${r2.modifiedCount} stores`);

  // ── 3. Recreate as proper sparse unique indexes ───────────────────────────
  await stores.createIndex(
    { stripeCustomerId: 1 },
    { unique: true, sparse: true, name: 'stripeCustomerId_1' }
  );
  console.log('✓ Recreated sparse unique index: stripeCustomerId_1');

  await stores.createIndex(
    { stripeSubscriptionId: 1 },
    { unique: true, sparse: true, name: 'stripeSubscriptionId_1' }
  );
  console.log('✓ Recreated sparse unique index: stripeSubscriptionId_1');

  // ── 4. Verify ─────────────────────────────────────────────────────────────
  const indexes = await stores.indexes();
  const stripeIndexes = indexes.filter(i =>
    i.name === 'stripeCustomerId_1' || i.name === 'stripeSubscriptionId_1'
  );
  console.log('\nVerified indexes:');
  stripeIndexes.forEach(i => console.log(`  ${i.name}:`, JSON.stringify({ unique: i.unique, sparse: i.sparse })));

  console.log('\n✅ Done! Restart the backend server — onboarding should work now.');
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Script failed:', err);
  mongoose.disconnect();
  process.exit(1);
});
