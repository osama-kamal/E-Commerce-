import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const FASHION_STORE_ID = new mongoose.Types.ObjectId('6a03bcac041f11a6299e39fc');
const DEFAULT_STORE_ID = new mongoose.Types.ObjectId('6a03b5108bdcd392044d1c37');

async function run() {
  await mongoose.connect(process.env.MONGO_URI!);
  console.log('Connected\n');

  const users = mongoose.connection.collection('users');

  // ── 1. Find osama's user (may be in Fashion Store or without storeId) ──────
  let osama = await users.findOne({ email: 'osamahamroush6@gmail.com' });
  console.log('Found osama:', JSON.stringify({
    id: osama?._id,
    email: osama?.email,
    role: osama?.role,
    storeId: osama?.storeId,
  }));

  if (osama) {
    // Promote to admin and ensure storeId is Fashion Store
    const r = await users.updateOne(
      { _id: osama._id },
      { $set: { role: 'admin', storeId: FASHION_STORE_ID } }
    );
    console.log(`✅ Promoted osamahamroush6@gmail.com to admin in Fashion Store (modified: ${r.modifiedCount})`);
  } else {
    console.log('❌ osamahamroush6@gmail.com not found — did you register with this email?');
  }

  // ── 2. Check admin@example.com ────────────────────────────────────────────
  const adminUser = await users.findOne({ email: 'admin@example.com' });
  console.log('\nAdmin user:', JSON.stringify({
    id: adminUser?._id,
    email: adminUser?.email,
    role: adminUser?.role,
    storeId: adminUser?.storeId,
  }));
  console.log('ℹ️  admin@example.com belongs to Default Store — use it with VITE_STORE_ID=6a03b5108bdcd392044d1c37');

  // ── 3. Verify Fashion Store exists ────────────────────────────────────────
  const fashionStore = await mongoose.connection.collection('stores').findOne({ _id: FASHION_STORE_ID });
  console.log('\nFashion Store:', JSON.stringify({
    id: fashionStore?._id,
    name: fashionStore?.name,
    slug: fashionStore?.slug,
    isActive: fashionStore?.isActive,
  }));

  // ── 4. List all users in Fashion Store ───────────────────────────────────
  const fashionUsers = await users.find({ storeId: FASHION_STORE_ID }).toArray();
  console.log(`\nAll users in Fashion Store (${fashionUsers.length}):`);
  fashionUsers.forEach(u => console.log(`  - ${u.email} | role: ${u.role}`));

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
