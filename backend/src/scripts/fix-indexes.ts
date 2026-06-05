/**
 * Fix stale MongoDB indexes after multi-tenant migration.
 * Run once: npx ts-node src/scripts/fix-indexes.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const COLLECTIONS_TO_FIX = [
  {
    name: 'wishlists',
    dropIndexes: ['customerId_1'],
    createIndex: { storeId: 1, customerId: 1 } as Record<string, number>,
  },
  {
    name: 'carts',
    dropIndexes: ['customerId_1'],
    createIndex: { storeId: 1, customerId: 1 } as Record<string, number>,
  },
  {
    name: 'users',
    dropIndexes: ['email_1'],
    createIndex: { storeId: 1, email: 1 } as Record<string, number>,
  },
];

async function run() {
  await mongoose.connect(process.env.MONGO_URI!);
  console.log('Connected\n');

  for (const col of COLLECTIONS_TO_FIX) {
    const collection = mongoose.connection.collection(col.name);

    // List current indexes
    const indexes = await collection.indexes();
    console.log(`\n=== ${col.name} indexes ===`);
    indexes.forEach(idx => console.log(`  ${idx.name}: ${JSON.stringify(idx.key)}`));

    // Drop stale indexes
    for (const idxName of col.dropIndexes) {
      const exists = indexes.some(i => i.name === idxName);
      if (exists) {
        try {
          await collection.dropIndex(idxName);
          console.log(`  ✅ Dropped: ${idxName}`);
        } catch (err: any) {
          console.log(`  ⚠️  Could not drop ${idxName}: ${err.message}`);
        }
      } else {
        console.log(`  ⏭️  ${idxName} not found (already removed)`);
      }
    }

    // Ensure new compound index exists
    try {
      await collection.createIndex(col.createIndex, { unique: true, background: true });
      console.log(`  ✅ Created: ${JSON.stringify(col.createIndex)}`);
    } catch (err: any) {
      console.log(`  ⚠️  Index create: ${err.message}`);
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
