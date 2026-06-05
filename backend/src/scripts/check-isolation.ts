import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI!);

  const products = await mongoose.connection.collection('products')
    .find({}).project({ name: 1, storeId: 1 }).toArray();

  const stores = await mongoose.connection.collection('stores')
    .find({}).project({ name: 1, slug: 1 }).toArray();

  const storeMap = Object.fromEntries(stores.map((s: any) => [s._id.toString(), `${s.name} (${s.slug})`]));

  console.log('\n=== Products by Store ===');
  const grouped: Record<string, string[]> = {};
  for (const p of products) {
    const sid = (p as any).storeId?.toString() ?? 'NO_STORE_ID';
    const sname = storeMap[sid] ?? `Unknown store: ${sid}`;
    if (!grouped[sname]) grouped[sname] = [];
    grouped[sname].push((p as any).name);
  }
  console.log(JSON.stringify(grouped, null, 2));

  console.log('\n=== Stores ===');
  for (const s of stores) {
    console.log(`  ${(s as any).name} (${(s as any).slug}) → ${(s as any)._id}`);
  }

  await mongoose.disconnect();
}

run().catch(console.error);
