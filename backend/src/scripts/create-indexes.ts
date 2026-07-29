import mongoose, { Model } from 'mongoose';
import dotenv from 'dotenv';
import { Order } from '../modules/orders/order.model';
import { Product } from '../modules/products/product.model';
import { User } from '../modules/auth/user.model';
import { Store } from '../modules/stores/store.model';
import { Review } from '../modules/reviews/review.model';
import { Cart } from '../modules/cart/cart.model';
import { Coupon } from '../modules/coupons/coupon.model';

dotenv.config();

/**
 * Creates every index declared on the Mongoose schemas, and reports any index
 * present in the database that no schema declares.
 *
 * Previously this script hand-wrote its own index list, which had two problems:
 *
 *   1. None of them included `storeId`. This is a multi-tenant application —
 *      every read filters by store first — so indexes like { createdAt, status }
 *      or { categoryId } could not serve the real queries. The schemas already
 *      declare the correct tenant-scoped compounds
 *      ({ storeId, status, createdAt }, { storeId, isDeleted, categoryId, price },
 *      …), so the hand-written ones only added write amplification.
 *
 *   2. The Stripe indexes were created under custom names for key patterns that
 *      Mongoose already indexes from the field definitions. MongoDB refuses a
 *      second index with the same key pattern and a different name, so the
 *      script could fail outright depending on whether autoIndex had run first.
 *
 * Deriving from the schemas keeps this in lockstep with the models and removes
 * the chance of drift. `createIndexes()` only ADDS what is missing — it never
 * drops, so running this is safe against a live database.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const MODELS: Array<{ name: string; model: Model<any> }> = [
  { name: 'Order', model: Order },
  { name: 'Product', model: Product },
  { name: 'User', model: User },
  { name: 'Store', model: Store },
  { name: 'Review', model: Review },
  { name: 'Cart', model: Cart },
  { name: 'Coupon', model: Coupon },
];

/** Serialises an index key pattern for comparison/reporting. */
function keySignature(key: Record<string, unknown>): string {
  return Object.entries(key).map(([k, v]) => `${k}:${v}`).join(',');
}

async function createIndexes() {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/ecommerce';
    console.log(`Connecting to ${uri.replace(/:([^@]+)@/, ':***@')} …`);
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    console.log('\n📊 Creating schema-declared indexes…\n');

    for (const { name, model } of MODELS) {
      await model.createIndexes();
      console.log(`✓ ${name}: schema indexes ensured`);
    }

    // ── Report drift ─────────────────────────────────────────────────────────
    // Anything in the database that no schema declares is reported rather than
    // dropped — dropping an index someone added deliberately would be worse
    // than leaving it. The operator decides.
    console.log('\n📋 Index report:\n');

    let orphanCount = 0;

    for (const { name, model } of MODELS) {
      const declared = new Set(
        model.schema.indexes().map(([key]) => keySignature(key as Record<string, unknown>))
      );

      const live = await model.collection.indexes();

      console.log(`${name}:`);
      for (const idx of live) {
        const sig = keySignature(idx.key as Record<string, unknown>);
        const isIdIndex = sig === '_id:1';
        const known = isIdIndex || declared.has(sig);
        if (!known) orphanCount++;
        console.log(`  ${known ? '·' : '⚠'} ${idx.name}  { ${sig} }${known ? '' : '   <- not declared by any schema'}`);
      }
      console.log('');
    }

    if (orphanCount > 0) {
      console.log(
        `⚠️  ${orphanCount} index(es) exist in the database but are not declared on a schema.\n` +
        `   Non-tenant-scoped indexes (no leading storeId) cannot serve this app's\n` +
        `   queries and only slow writes down. Review them and drop with:\n` +
        `     db.<collection>.dropIndex("<indexName>")\n`
      );
    } else {
      console.log('✅ No undeclared indexes — database matches the schemas.\n');
    }

  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

createIndexes();
