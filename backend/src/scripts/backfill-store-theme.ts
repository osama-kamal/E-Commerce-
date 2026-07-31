/**
 * backfill-store-theme.ts
 *
 * Sets `theme: 'default'` on every store document that does not yet have the
 * field.
 *
 * Why this is needed: Mongoose applies a schema default when a document is
 * CREATED, not when one is read, and `.lean()` returns raw BSON either way. So
 * stores written before the theme feature shipped come back as
 * `theme: undefined` rather than `'default'` — which would leave the API
 * reporting no theme for every pre-existing store.
 *
 * `resolveTheme()` in store.model.ts already normalises undefined to 'default'
 * at every read site, so the application is correct without this script. Running
 * it makes the database self-describing too, which keeps ad-hoc queries,
 * aggregations and exports honest.
 *
 * Only touches documents where the field is missing — an existing choice is
 * never overwritten. Safe to run repeatedly.
 *
 * Run once per environment:
 *   cd backend && npm run migrate:store-theme
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { DEFAULT_STORE_THEME } from '../modules/stores/store.model';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
  await mongoose.connect(uri);
  console.log('Connected.\n');

  const stores = mongoose.connection.collection('stores');

  const total = await stores.countDocuments({});
  const missing = await stores.countDocuments({ theme: { $exists: false } });

  console.log(`  stores total          : ${total}`);
  console.log(`  missing a theme field : ${missing}`);

  if (missing === 0) {
    console.log('\n✓ Every store already has a theme — nothing to do.');
  } else {
    const res = await stores.updateMany(
      { theme: { $exists: false } },
      { $set: { theme: DEFAULT_STORE_THEME } }
    );
    console.log(`\n✓ Backfilled ${res.modifiedCount} store(s) with theme='${DEFAULT_STORE_THEME}'.`);
  }

  // Report anything holding a value outside the known set. Not corrected
  // automatically — resolveTheme() renders those as default, and silently
  // rewriting data the script does not understand is worse than reporting it.
  const unknown = await stores
    .find(
      { theme: { $exists: true, $nin: ['default', 'luxury', 'modern', 'minimal', 'fashion', 'marketplace'] } },
      { projection: { _id: 1, slug: 1, theme: 1 } }
    )
    .toArray();

  if (unknown.length > 0) {
    console.log(`\n⚠ ${unknown.length} store(s) hold an unrecognised theme:`);
    for (const s of unknown) console.log(`    ${s.slug ?? s._id} -> ${JSON.stringify(s.theme)}`);
    console.log('  These render the default design. Fix them in Store Settings.');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
