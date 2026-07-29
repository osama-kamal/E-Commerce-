/**
 * fix-order-idempotency-index.ts
 *
 * Replaces the order idempotency index with a partial-filter version.
 *
 * The old definition was:
 *   { storeId: 1, customerId: 1, idempotencyKey: 1 }  { unique: true, sparse: true }
 *
 * A COMPOUND sparse index includes a document when ANY indexed field is present.
 * storeId and customerId are always present, so every order was indexed — and
 * every order without an idempotency key indexed as `idempotencyKey: null`.
 * A customer could therefore place only ONE key-less order per store; the second
 * failed with E11000. The web checkout always sends a key, but any other client
 * (mobile, API integration, seed script, admin-placed order) hit a hard wall.
 *
 * The replacement indexes only documents where idempotencyKey is a real string.
 *
 * Mongoose creates missing indexes on boot but never drops obsolete ones, so the
 * schema change alone does not fix an existing database.
 *
 * Safe to run repeatedly.
 *
 * Run once per environment:
 *   cd backend && npm run migrate:order-idempotency-index
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const COMPOUND = 'storeId_1_customerId_1_idempotencyKey_1';
const LEGACY_SINGLE = 'idempotencyKey_1';

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const orders = mongoose.connection.collection('orders');

  const before = await orders.indexes();
  const existing = before.find((i) => i.name === COMPOUND);

  if (existing?.partialFilterExpression) {
    console.log('✓ Compound index already uses a partial filter — nothing to do.');
  } else {
    if (existing) {
      await orders.dropIndex(COMPOUND);
      console.log(`✓ Dropped legacy sparse index: ${COMPOUND}`);
    } else {
      console.log(`  Index not present: ${COMPOUND}`);
    }

    await orders.createIndex(
      { storeId: 1, customerId: 1, idempotencyKey: 1 },
      { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
    );
    console.log(`✓ Created ${COMPOUND} with partialFilterExpression`);
  }

  // The field-level `sparse: true` used to create a redundant single-field index.
  try {
    await orders.dropIndex(LEGACY_SINGLE);
    console.log(`✓ Dropped redundant index: ${LEGACY_SINGLE}`);
  } catch (e: unknown) {
    const err = e as { code?: number; codeName?: string };
    if (err?.codeName === 'IndexNotFound' || err?.code === 27) {
      console.log(`  Not present (fine): ${LEGACY_SINGLE}`);
    } else {
      throw e;
    }
  }

  // Normalise any rows that stored an explicit null so they fall outside the
  // partial filter cleanly.
  const res = await orders.updateMany(
    { idempotencyKey: null },
    { $unset: { idempotencyKey: '' } }
  );
  console.log(`✓ Normalised ${res.modifiedCount} order(s) with a null idempotencyKey`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
