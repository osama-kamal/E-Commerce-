/**
 * Image Update Script — patches product images without wiping data
 * Run: npx ts-node src/update-images.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/ecommerce';

const productSchema = new mongoose.Schema({ name: String, images: [String] });
const Product = mongoose.model('Product', productSchema);

// Map of product name → 5 curated Unsplash images
const IMAGE_MAP: Record<string, string[]> = {
  // ── Electronics / Phones ──────────────────────────────────────────────────
  'iPhone 15 Pro': [
    'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&q=80',
    'https://images.unsplash.com/photo-1591337676887-a217a6970a8a?w=600&q=80',
    'https://images.unsplash.com/photo-1574755393849-623942496936?w=600&q=80',
    'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=600&q=80',
    'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=600&q=80',
  ],
  'Samsung Galaxy S24 Ultra': [
    'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&q=80',
    'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&q=80',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80',
    'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=600&q=80',
    'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=600&q=80',
  ],
  'Google Pixel 8': [
    'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&q=80',
    'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=600&q=80',
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80',
    'https://images.unsplash.com/photo-1574755393849-623942496936?w=600&q=80',
    'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=600&q=80',
  ],
  'OnePlus 12': [
    'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=600&q=80',
    'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=600&q=80',
    'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=600&q=80',
    'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=600&q=80',
    'https://images.unsplash.com/photo-1574755393849-623942496936?w=600&q=80',
  ],

  // ── Electronics / Laptops ─────────────────────────────────────────────────
  'MacBook Pro 14"': [
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&q=80',
    'https://images.unsplash.com/photo-1611186871525-9c4f9b855c3e?w=600&q=80',
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&q=80',
    'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600&q=80',
    'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&q=80',
  ],
  'Dell XPS 15': [
    'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600&q=80',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&q=80',
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&q=80',
    'https://images.unsplash.com/photo-1611186871525-9c4f9b855c3e?w=600&q=80',
    'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&q=80',
  ],
  'Lenovo ThinkPad X1 Carbon': [
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&q=80',
    'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600&q=80',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&q=80',
    'https://images.unsplash.com/photo-1611186871525-9c4f9b855c3e?w=600&q=80',
    'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&q=80',
  ],
  'ASUS ROG Zephyrus G14': [
    'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=600&q=80',
    'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=600&q=80',
    'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=600&q=80',
    'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&q=80',
    'https://images.unsplash.com/photo-1611186871525-9c4f9b855c3e?w=600&q=80',
  ],

  // ── Electronics / Accessories ─────────────────────────────────────────────
  'AirPods Pro (2nd Gen)': [
    'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&q=80',
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&q=80',
    'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=600&q=80',
    'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&q=80',
  ],
  'Sony WH-1000XM5': [
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&q=80',
    'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&q=80',
    'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=600&q=80',
    'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&q=80',
  ],
  'Apple Watch Series 9': [
    'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=600&q=80',
    'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&q=80',
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&q=80',
    'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&q=80',
  ],
  'Anker 65W USB-C Charger': [
    'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600&q=80',
    'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=600&q=80',
    'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=600&q=80',
    'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=600&q=80',
    'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=600&q=80',
  ],

  // ── Clothing / Men's ──────────────────────────────────────────────────────
  'Classic Oxford Shirt': [
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600&q=80',
    'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=600&q=80',
    'https://images.unsplash.com/photo-1607345366928-199ea26cfe3e?w=600&q=80',
    'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=600&q=80',
    'https://images.unsplash.com/photo-1594938298603-c8148c4b4357?w=600&q=80',
  ],
  'Slim Fit Chinos': [
    'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=600&q=80',
    'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=600&q=80',
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=600&q=80',
    'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=600&q=80',
    'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=600&q=80',
  ],
  'Merino Wool Sweater': [
    'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&q=80',
    'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=600&q=80',
    'https://images.unsplash.com/photo-1607345366928-199ea26cfe3e?w=600&q=80',
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600&q=80',
    'https://images.unsplash.com/photo-1594938298603-c8148c4b4357?w=600&q=80',
  ],

  // ── Clothing / Women's ────────────────────────────────────────────────────
  'Floral Wrap Dress': [
    'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&q=80',
    'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=600&q=80',
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&q=80',
    'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&q=80',
    'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600&q=80',
  ],
  'High-Waist Yoga Pants': [
    'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=600&q=80',
    'https://images.unsplash.com/photo-1571945153237-4929e783af4a?w=600&q=80',
    'https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=600&q=80',
    'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=600&q=80',
    'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&q=80',
  ],
  'Cashmere Turtleneck': [
    'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=600&q=80',
    'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&q=80',
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&q=80',
    'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=600&q=80',
    'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&q=80',
  ],

  // ── Home & Garden / Furniture ─────────────────────────────────────────────
  'Ergonomic Office Chair': [
    'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=600&q=80',
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&q=80',
    'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=600&q=80',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=80',
    'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=600&q=80',
  ],
  'Standing Desk': [
    'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&q=80',
    'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=600&q=80',
    'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=600&q=80',
    'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=600&q=80',
    'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=80',
  ],
};

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  let updated = 0;
  for (const [name, images] of Object.entries(IMAGE_MAP)) {
    const result = await Product.updateOne({ name }, { $set: { images } });
    if (result.modifiedCount > 0) {
      console.log(`  ✓ ${name}`);
      updated++;
    } else {
      console.log(`  ⚠ Not found: ${name}`);
    }
  }

  console.log(`\n✅ Updated ${updated} products`);
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
