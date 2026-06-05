/**
 * Bootstrap Script — creates the default development store.
 *
 * Run once after the multi-tenant migration:
 *   npx ts-node src/scripts/bootstrap-store.ts
 *
 * It will:
 *  1. Connect to MongoDB
 *  2. Create (or find) the default store with slug "default"
 *  3. Create (or find) the admin user scoped to that store
 *  4. Print the Store ID so you can paste it into client/.env as VITE_STORE_ID
 *  5. Migrate all existing documents (products, orders, etc.) to belong to that store
 */

import mongoose, { Types } from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/ecommerce';

// ── Minimal inline schemas (avoids circular import issues in scripts) ─────────

const storeSchema = new mongoose.Schema({
  name: String,
  slug: { type: String, unique: true, lowercase: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  subscriptionPlan: { type: String, default: 'free' },
  subscriptionStatus: { type: String, default: 'active' },
  customDomain: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store' },
  email: { type: String, lowercase: true },
  passwordHash: String,
  role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
  isActive: { type: Boolean, default: true },
  refreshTokens: { type: Array, default: [] },
}, { timestamps: true });

const Store = mongoose.model('Store', storeSchema);
const User = mongoose.model('User', userSchema);

// Collections that need storeId backfilled
const COLLECTIONS_TO_MIGRATE = [
  'products',
  'orders',
  'carts',
  'coupons',
  'categories',
  'reviews',
  'wishlists',
  'newslettersubscribers',
];

async function run() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  // ── 1. Create or find the default store ────────────────────────────────────
  let store = await Store.findOne({ slug: 'default' });

  if (!store) {
    console.log('🏪 Creating default store...');

    // We need an owner — find or create the admin user first (without storeId for now)
    let adminUser = await User.findOne({ email: 'admin@example.com' });

    if (!adminUser) {
      const passwordHash = await bcrypt.hash('Admin123!', 12);
      adminUser = await User.create({
        email: 'admin@example.com',
        passwordHash,
        role: 'admin',
        isActive: true,
      });
      console.log('👤 Created admin user: admin@example.com / Admin123!');
    }

    store = await Store.create({
      name: 'Default Store',
      slug: 'default',
      ownerId: adminUser._id,
      subscriptionPlan: 'pro',
      subscriptionStatus: 'active',
      isActive: true,
    });

    console.log(`✅ Store created: "${store.name}" (slug: ${store.slug})`);
  } else {
    console.log(`✅ Store already exists: "${store.name}" (slug: ${store.slug})`);
  }

  const storeId = (store._id as Types.ObjectId);
  console.log(`\n📋 Store ID: ${storeId}\n`);

  // ── 2. Ensure admin user has storeId ──────────────────────────────────────
  const adminResult = await User.updateMany(
    { role: 'admin', storeId: { $exists: false } },
    { $set: { storeId } }
  );
  if (adminResult.modifiedCount > 0) {
    console.log(`👤 Updated ${adminResult.modifiedCount} admin user(s) with storeId`);
  }

  // Also update all users missing storeId
  const userResult = await User.updateMany(
    { storeId: { $exists: false } },
    { $set: { storeId } }
  );
  if (userResult.modifiedCount > 0) {
    console.log(`👥 Updated ${userResult.modifiedCount} user(s) with storeId`);
  }

  // ── 3. Backfill storeId on all existing documents ─────────────────────────
  console.log('\n🔄 Migrating existing documents...');

  for (const collectionName of COLLECTIONS_TO_MIGRATE) {
    try {
      const collection = mongoose.connection.collection(collectionName);
      const result = await collection.updateMany(
        { storeId: { $exists: false } },
        { $set: { storeId } }
      );
      if (result.modifiedCount > 0) {
        console.log(`  ✅ ${collectionName}: updated ${result.modifiedCount} documents`);
      } else {
        console.log(`  ⏭️  ${collectionName}: no documents needed migration`);
      }
    } catch (err) {
      console.log(`  ⚠️  ${collectionName}: skipped (${(err as Error).message})`);
    }
  }

  // ── 4. Print instructions ─────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('✅ Bootstrap complete!\n');
  console.log('Add this to your client/.env file:');
  console.log(`\n  VITE_STORE_ID=${storeId}\n`);
  console.log('Or use the slug instead:');
  console.log(`\n  VITE_STORE_SLUG=default\n`);
  console.log('='.repeat(60));

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Bootstrap failed:', err);
  process.exit(1);
});
