import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI!);

  const carts = await mongoose.connection.collection('carts').find({}).toArray();
  const stores = await mongoose.connection.collection('stores').find({}).project({ name: 1, slug: 1 }).toArray();
  const storeMap = Object.fromEntries(stores.map((s: any) => [s._id.toString(), s.name]));

  console.log(`\n=== Carts in DB (${carts.length} total) ===`);
  for (const cart of carts) {
    const c = cart as any;
    console.log(`\nCart ID: ${c._id}`);
    console.log(`  Store: ${storeMap[c.storeId?.toString()] ?? c.storeId} (${c.storeId})`);
    console.log(`  Customer: ${c.customerId}`);
    console.log(`  Items: ${c.items?.length ?? 0}`);
    if (c.items?.length > 0) {
      c.items.forEach((item: any) => {
        console.log(`    - productId: ${item.productId}, qty: ${item.quantity}`);
      });
    }
  }

  await mongoose.disconnect();
}

run().catch(console.error);
