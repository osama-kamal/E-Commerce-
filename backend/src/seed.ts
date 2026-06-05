// Database Seed Script
// Run: npx ts-node src/seed.ts
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://localhost:27017/ecommerce';

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, lowercase: true },
  passwordHash: String,
  role: { type: String, enum: ['admin', 'customer'], default: 'customer' },
  isActive: { type: Boolean, default: true },
  refreshTokens: { type: Array, default: [] },
}, { timestamps: true });

const categorySchema = new mongoose.Schema({
  name: String,
  slug: { type: String, unique: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
  level: { type: Number, default: 0 },
}, { timestamps: { createdAt: true, updatedAt: false } });

const productSchema = new mongoose.Schema({
  name: String,
  description: String,
  price: Number,
  discount: { type: Number, default: 0 },
  stock: Number,
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  images: [String],
  isDeleted: { type: Boolean, default: false },
  averageRating: { type: Number, default: 0 },
  reviewCount: { type: Number, default: 0 },
}, { timestamps: true });

const orderSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  items: [{ productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, quantity: Number, price: Number, name: String }],
  totalAmount: Number,
  status: { type: String, enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  shippingAddress: { line1: String, city: String, state: String, postalCode: String, country: String },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Category = mongoose.model('Category', categorySchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);

// ── Image pools: 10 images per category ──────────────────────────────────────
const phoneImages = [
  'https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=800&q=85',
  'https://images.unsplash.com/photo-1591337676887-a217a6970a8a?w=800&q=85',
  'https://images.unsplash.com/photo-1610945415295-d9bbf067e59c?w=800&q=85',
  'https://images.unsplash.com/photo-1598327105666-5b89351aff97?w=800&q=85',
  'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=85',
  'https://images.unsplash.com/photo-1580910051074-3eb694886505?w=800&q=85',
  'https://images.unsplash.com/photo-1574755393849-623942496936?w=800&q=85',
  'https://images.unsplash.com/photo-1556656793-08538906a9f8?w=800&q=85',
  'https://images.unsplash.com/photo-1565849904461-04a58ad377e0?w=800&q=85',
  'https://images.unsplash.com/photo-1567581935884-3349723552ca?w=800&q=85',
];

const laptopImages = [
  'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=800&q=85',
  'https://images.unsplash.com/photo-1611186871525-9c4f9b855c3e?w=800&q=85',
  'https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=800&q=85',
  'https://images.unsplash.com/photo-1593642632559-0c6d3fc62b89?w=800&q=85',
  'https://images.unsplash.com/photo-1603302576837-37561b2e2302?w=800&q=85',
  'https://images.unsplash.com/photo-1525547719571-a2d4ac8945e2?w=800&q=85',
  'https://images.unsplash.com/photo-1541807084-5c52b6b3adef?w=800&q=85',
  'https://images.unsplash.com/photo-1484788984921-03950022c9ef?w=800&q=85',
  'https://images.unsplash.com/photo-1588872657578-7efd1f1555ed?w=800&q=85',
  'https://images.unsplash.com/photo-1629131726692-1accd0c53ce0?w=800&q=85',
];

const accessoryImages = [
  'https://images.unsplash.com/photo-1600294037681-c80b4cb5b434?w=800&q=85',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=85',
  'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=800&q=85',
  'https://images.unsplash.com/photo-1546868871-7041f2a55e12?w=800&q=85',
  'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=800&q=85',
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=85',
  'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=800&q=85',
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=800&q=85',
  'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=800&q=85',
  'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=800&q=85',
];

const menImages = [
  'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=800&q=85',
  'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=800&q=85',
  'https://images.unsplash.com/photo-1607345366928-199ea26cfe3e?w=800&q=85',
  'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=800&q=85',
  'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=800&q=85',
  'https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?w=800&q=85',
  'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=85',
  'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800&q=85',
  'https://images.unsplash.com/photo-1617137968427-85924c800a22?w=800&q=85',
  'https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?w=800&q=85',
];

const womenImages = [
  'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=800&q=85',
  'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?w=800&q=85',
  'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&q=85',
  'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=85',
  'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=85',
  'https://images.unsplash.com/photo-1506629082955-511b1aa562c8?w=800&q=85',
  'https://images.unsplash.com/photo-1571945153237-4929e783af4a?w=800&q=85',
  'https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=800&q=85',
  'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=800&q=85',
  'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=85',
];

const furnitureImages = [
  'https://images.unsplash.com/photo-1592078615290-033ee584e267?w=800&q=85',
  'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=800&q=85',
  'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800&q=85',
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=800&q=85',
  'https://images.unsplash.com/photo-1493663284031-b7e3aefcae8e?w=800&q=85',
  'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=800&q=85',
  'https://images.unsplash.com/photo-1538688525198-9b88f6f53126?w=800&q=85',
  'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=800&q=85',
  'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800&q=85',
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=800&q=85',
];

// Pick 4 images for a product at index i
function pick4(pool: string[], i: number): string[] {
  return [0, 1, 2, 3].map(j => pool[(i + j) % pool.length]);
}

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  await Promise.all([User.deleteMany({}), Category.deleteMany({}), Product.deleteMany({}), Order.deleteMany({})]);
  console.log('🗑️  Cleared existing data');

  // ── Users ──────────────────────────────────────────────────────────────────
  const [adminHash, userHash] = await Promise.all([bcrypt.hash('Admin123!', 12), bcrypt.hash('User123!', 12)]);
  await User.insertMany([
    { email: 'admin@shop.com', passwordHash: adminHash, role: 'admin', isActive: true },
    { email: 'user@shop.com', passwordHash: userHash, role: 'customer', isActive: true },
  ]);
  console.log('👤 Users created');

  // ── Categories ─────────────────────────────────────────────────────────────
  const electronics = await Category.create({ name: 'Electronics', slug: 'electronics', level: 0 });
  const clothing    = await Category.create({ name: 'Clothing',    slug: 'clothing',    level: 0 });
  const homeGarden  = await Category.create({ name: 'Home & Garden', slug: 'home-garden', level: 0 });
  const phones      = await Category.create({ name: 'Phones',      slug: 'phones',      parentId: electronics._id, level: 1 });
  const laptops     = await Category.create({ name: 'Laptops',     slug: 'laptops',     parentId: electronics._id, level: 1 });
  const accessories = await Category.create({ name: 'Accessories', slug: 'accessories', parentId: electronics._id, level: 1 });
  const men         = await Category.create({ name: "Men's",       slug: 'mens',        parentId: clothing._id,    level: 1 });
  const women       = await Category.create({ name: "Women's",     slug: 'womens',      parentId: clothing._id,    level: 1 });
  const furniture   = await Category.create({ name: 'Furniture',   slug: 'furniture',   parentId: homeGarden._id,  level: 1 });
  console.log('📂 Categories created');

  // ── Products: 10 per sub-category, 4 images each ──────────────────────────
  const products = [
    // Phones
    { name: 'iPhone 15 Pro', description: 'Apple iPhone 15 Pro with A17 Pro chip and titanium design.', price: 999.99, discount: 20, stock: 25, categoryId: phones._id, averageRating: 4.8, reviewCount: 124, images: pick4(phoneImages, 0) },
    { name: 'Samsung Galaxy S24 Ultra', description: 'Samsung flagship with built-in S Pen and 200MP camera.', price: 1199.99, discount: 15, stock: 18, categoryId: phones._id, averageRating: 4.7, reviewCount: 89, images: pick4(phoneImages, 1) },
    { name: 'Google Pixel 8', description: 'Google Pixel 8 with Tensor G3 chip and 7 years of updates.', price: 699.99, discount: 25, stock: 30, categoryId: phones._id, averageRating: 4.5, reviewCount: 67, images: pick4(phoneImages, 2) },
    { name: 'OnePlus 12', description: 'OnePlus 12 with Snapdragon 8 Gen 3 and 100W fast charging.', price: 799.99, stock: 0, categoryId: phones._id, averageRating: 4.4, reviewCount: 45, images: pick4(phoneImages, 3) },
    { name: 'Xiaomi 14 Ultra', description: 'Xiaomi 14 Ultra with Leica optics and 90W wireless charging.', price: 899.99, discount: 10, stock: 20, categoryId: phones._id, averageRating: 4.6, reviewCount: 78, images: pick4(phoneImages, 4) },
    { name: 'Sony Xperia 1 VI', description: 'Sony Xperia 1 VI with 4K OLED display and pro-grade camera.', price: 1099.99, stock: 12, categoryId: phones._id, averageRating: 4.3, reviewCount: 34, images: pick4(phoneImages, 5) },
    { name: 'Motorola Edge 50 Pro', description: 'Motorola Edge 50 Pro with 125W TurboPower charging.', price: 549.99, discount: 30, stock: 40, categoryId: phones._id, averageRating: 4.2, reviewCount: 56, images: pick4(phoneImages, 6) },
    { name: 'Nothing Phone 2', description: 'Nothing Phone 2 with unique Glyph Interface and clean Android.', price: 599.99, stock: 15, categoryId: phones._id, averageRating: 4.4, reviewCount: 43, images: pick4(phoneImages, 7) },
    { name: 'ASUS ROG Phone 8', description: 'Gaming phone with Snapdragon 8 Gen 3 and 165Hz display.', price: 999.99, stock: 8, categoryId: phones._id, averageRating: 4.6, reviewCount: 62, images: pick4(phoneImages, 8) },
    { name: 'Oppo Find X7 Ultra', description: 'Oppo Find X7 Ultra with Hasselblad camera and 100W charging.', price: 1099.99, discount: 5, stock: 10, categoryId: phones._id, averageRating: 4.5, reviewCount: 29, images: pick4(phoneImages, 9) },

    // Laptops
    { name: 'MacBook Pro 14"', description: 'Apple MacBook Pro with M3 Pro chip and Liquid Retina XDR display.', price: 1999.99, stock: 12, categoryId: laptops._id, averageRating: 4.9, reviewCount: 203, images: pick4(laptopImages, 0) },
    { name: 'Dell XPS 15', description: 'Dell XPS 15 with Intel Core i9 and NVIDIA RTX 4070.', price: 1799.99, stock: 8, categoryId: laptops._id, averageRating: 4.6, reviewCount: 78, images: pick4(laptopImages, 1) },
    { name: 'Lenovo ThinkPad X1 Carbon', description: 'Business ultrabook with Intel Core i7 and legendary keyboard.', price: 1499.99, stock: 15, categoryId: laptops._id, averageRating: 4.7, reviewCount: 156, images: pick4(laptopImages, 2) },
    { name: 'ASUS ROG Zephyrus G14', description: 'Gaming laptop with AMD Ryzen 9 and RTX 4060.', price: 1399.99, stock: 6, categoryId: laptops._id, averageRating: 4.5, reviewCount: 92, images: pick4(laptopImages, 3) },
    { name: 'HP Spectre x360', description: 'Premium 2-in-1 laptop with OLED display and Intel Evo platform.', price: 1599.99, discount: 10, stock: 10, categoryId: laptops._id, averageRating: 4.6, reviewCount: 87, images: pick4(laptopImages, 4) },
    { name: 'Microsoft Surface Laptop 5', description: 'Surface Laptop 5 with Intel Core i7 and PixelSense display.', price: 1299.99, stock: 14, categoryId: laptops._id, averageRating: 4.4, reviewCount: 65, images: pick4(laptopImages, 5) },
    { name: 'Razer Blade 15', description: 'Razer Blade 15 gaming laptop with RTX 4080 and 240Hz display.', price: 2499.99, stock: 5, categoryId: laptops._id, averageRating: 4.7, reviewCount: 112, images: pick4(laptopImages, 6) },
    { name: 'Acer Swift X', description: 'Thin and light laptop with AMD Ryzen 7 and NVIDIA RTX 3050.', price: 899.99, discount: 15, stock: 20, categoryId: laptops._id, averageRating: 4.3, reviewCount: 54, images: pick4(laptopImages, 7) },
    { name: 'LG Gram 16', description: 'Ultra-lightweight 16-inch laptop under 1.2kg with Intel Core i7.', price: 1349.99, stock: 9, categoryId: laptops._id, averageRating: 4.5, reviewCount: 73, images: pick4(laptopImages, 8) },
    { name: 'Samsung Galaxy Book4 Pro', description: 'Samsung Galaxy Book4 Pro with AMOLED display and Intel Core Ultra.', price: 1449.99, discount: 8, stock: 11, categoryId: laptops._id, averageRating: 4.4, reviewCount: 48, images: pick4(laptopImages, 9) },

    // Accessories
    { name: 'AirPods Pro (2nd Gen)', description: 'Apple AirPods Pro with Active Noise Cancellation and USB-C.', price: 249.99, discount: 30, stock: 50, categoryId: accessories._id, averageRating: 4.8, reviewCount: 312, images: pick4(accessoryImages, 0) },
    { name: 'Sony WH-1000XM5', description: 'Industry-leading noise canceling headphones with 30-hour battery.', price: 349.99, discount: 10, stock: 22, categoryId: accessories._id, averageRating: 4.9, reviewCount: 445, images: pick4(accessoryImages, 1) },
    { name: 'Apple Watch Series 9', description: 'Apple Watch Series 9 with S9 chip and Always-On Retina display.', price: 399.99, stock: 35, categoryId: accessories._id, averageRating: 4.7, reviewCount: 189, images: pick4(accessoryImages, 2) },
    { name: 'Anker 65W USB-C Charger', description: 'Compact 65W GaN charger with 3 ports for all devices.', price: 45.99, stock: 100, categoryId: accessories._id, averageRating: 4.6, reviewCount: 567, images: pick4(accessoryImages, 3) },
    { name: 'Samsung Galaxy Watch 6', description: 'Samsung Galaxy Watch 6 with advanced health tracking.', price: 299.99, discount: 20, stock: 28, categoryId: accessories._id, averageRating: 4.5, reviewCount: 134, images: pick4(accessoryImages, 4) },
    { name: 'Bose QuietComfort 45', description: 'Bose QC45 with world-class noise cancellation and 24-hour battery.', price: 279.99, stock: 18, categoryId: accessories._id, averageRating: 4.7, reviewCount: 278, images: pick4(accessoryImages, 5) },
    { name: 'Logitech MX Master 3S', description: 'Premium wireless mouse with MagSpeed scroll and 8K DPI sensor.', price: 99.99, stock: 45, categoryId: accessories._id, averageRating: 4.8, reviewCount: 389, images: pick4(accessoryImages, 6) },
    { name: 'Belkin MagSafe Charger', description: 'Belkin 15W MagSafe wireless charger for iPhone 12 and later.', price: 39.99, stock: 80, categoryId: accessories._id, averageRating: 4.4, reviewCount: 223, images: pick4(accessoryImages, 7) },
    { name: 'JBL Flip 6', description: 'Portable waterproof Bluetooth speaker with 12-hour playtime.', price: 129.99, discount: 15, stock: 55, categoryId: accessories._id, averageRating: 4.6, reviewCount: 456, images: pick4(accessoryImages, 8) },
    { name: 'Apple Pencil Pro', description: 'Apple Pencil Pro with squeeze gesture and barrel roll support.', price: 129.99, stock: 30, categoryId: accessories._id, averageRating: 4.7, reviewCount: 167, images: pick4(accessoryImages, 9) },

    // Men's Clothing
    { name: 'Classic Oxford Shirt', description: 'Premium 100% cotton Oxford shirt with button-down collar.', price: 59.99, stock: 75, categoryId: men._id, averageRating: 4.3, reviewCount: 234, images: pick4(menImages, 0) },
    { name: 'Slim Fit Chinos', description: 'Modern slim fit chino pants in stretch cotton blend.', price: 79.99, stock: 60, categoryId: men._id, averageRating: 4.4, reviewCount: 178, images: pick4(menImages, 1) },
    { name: 'Merino Wool Sweater', description: 'Luxuriously soft merino wool crew neck sweater.', price: 129.99, stock: 3, categoryId: men._id, averageRating: 4.6, reviewCount: 89, images: pick4(menImages, 2) },
    { name: 'Linen Summer Shirt', description: 'Breathable linen shirt perfect for warm weather.', price: 49.99, discount: 20, stock: 90, categoryId: men._id, averageRating: 4.2, reviewCount: 145, images: pick4(menImages, 3) },
    { name: 'Slim Fit Suit Jacket', description: 'Tailored slim fit suit jacket in premium wool blend.', price: 249.99, stock: 20, categoryId: men._id, averageRating: 4.5, reviewCount: 67, images: pick4(menImages, 4) },
    { name: 'Casual Denim Jacket', description: 'Classic denim jacket with a modern slim fit.', price: 89.99, discount: 10, stock: 35, categoryId: men._id, averageRating: 4.3, reviewCount: 112, images: pick4(menImages, 5) },
    { name: 'Performance Polo Shirt', description: 'Moisture-wicking polo shirt for sport and casual wear.', price: 44.99, stock: 65, categoryId: men._id, averageRating: 4.4, reviewCount: 198, images: pick4(menImages, 6) },
    { name: 'Wool Blend Trousers', description: 'Smart wool blend trousers with a tailored fit.', price: 119.99, stock: 25, categoryId: men._id, averageRating: 4.5, reviewCount: 78, images: pick4(menImages, 7) },
    { name: 'Graphic Print T-Shirt', description: 'Premium cotton t-shirt with artistic graphic print.', price: 34.99, discount: 25, stock: 100, categoryId: men._id, averageRating: 4.1, reviewCount: 267, images: pick4(menImages, 8) },
    { name: 'Waterproof Parka', description: 'Waterproof parka with removable inner fleece lining.', price: 199.99, stock: 15, categoryId: men._id, averageRating: 4.6, reviewCount: 93, images: pick4(menImages, 9) },

    // Women's Clothing
    { name: 'Floral Wrap Dress', description: 'Elegant wrap dress in lightweight chiffon with floral print.', price: 89.99, stock: 45, categoryId: women._id, averageRating: 4.5, reviewCount: 312, images: pick4(womenImages, 0) },
    { name: 'High-Waist Yoga Pants', description: 'Four-way stretch yoga pants with moisture-wicking fabric.', price: 69.99, stock: 80, categoryId: women._id, averageRating: 4.7, reviewCount: 456, images: pick4(womenImages, 1) },
    { name: 'Cashmere Turtleneck', description: 'Pure cashmere turtleneck sweater in a relaxed fit.', price: 199.99, stock: 20, categoryId: women._id, averageRating: 4.8, reviewCount: 134, images: pick4(womenImages, 2) },
    { name: 'Silk Blouse', description: 'Luxurious 100% silk blouse with a relaxed drape.', price: 149.99, discount: 15, stock: 30, categoryId: women._id, averageRating: 4.6, reviewCount: 89, images: pick4(womenImages, 3) },
    { name: 'Midi Pleated Skirt', description: 'Elegant midi skirt with pleated design in satin fabric.', price: 79.99, stock: 40, categoryId: women._id, averageRating: 4.4, reviewCount: 167, images: pick4(womenImages, 4) },
    { name: 'Oversized Blazer', description: 'Trendy oversized blazer for a chic, modern look.', price: 129.99, discount: 20, stock: 25, categoryId: women._id, averageRating: 4.5, reviewCount: 203, images: pick4(womenImages, 5) },
    { name: 'Lace Trim Camisole', description: 'Delicate lace trim camisole in soft modal fabric.', price: 39.99, stock: 70, categoryId: women._id, averageRating: 4.3, reviewCount: 245, images: pick4(womenImages, 6) },
    { name: 'Wide Leg Trousers', description: 'Sophisticated wide leg trousers in crepe fabric.', price: 99.99, stock: 35, categoryId: women._id, averageRating: 4.5, reviewCount: 178, images: pick4(womenImages, 7) },
    { name: 'Knit Cardigan', description: 'Cozy knit cardigan with button front and ribbed trim.', price: 89.99, discount: 10, stock: 50, categoryId: women._id, averageRating: 4.6, reviewCount: 289, images: pick4(womenImages, 8) },
    { name: 'Denim Mini Skirt', description: 'Classic denim mini skirt with a modern high-waist cut.', price: 59.99, stock: 55, categoryId: women._id, averageRating: 4.2, reviewCount: 134, images: pick4(womenImages, 9) },

    // Furniture
    { name: 'Ergonomic Office Chair', description: 'Premium ergonomic chair with lumbar support and breathable mesh.', price: 449.99, stock: 10, categoryId: furniture._id, averageRating: 4.6, reviewCount: 267, images: pick4(furnitureImages, 0) },
    { name: 'Standing Desk', description: 'Electric height-adjustable standing desk with memory presets.', price: 599.99, stock: 7, categoryId: furniture._id, averageRating: 4.7, reviewCount: 189, images: pick4(furnitureImages, 1) },
    { name: 'Sectional Sofa', description: 'L-shaped sectional sofa in premium fabric with chaise lounge.', price: 1299.99, discount: 15, stock: 5, categoryId: furniture._id, averageRating: 4.5, reviewCount: 134, images: pick4(furnitureImages, 2) },
    { name: 'Solid Wood Dining Table', description: 'Handcrafted solid oak dining table seats 6 comfortably.', price: 899.99, stock: 8, categoryId: furniture._id, averageRating: 4.7, reviewCount: 98, images: pick4(furnitureImages, 3) },
    { name: 'Platform Bed Frame', description: 'Modern platform bed frame in walnut finish, King size.', price: 749.99, discount: 10, stock: 6, categoryId: furniture._id, averageRating: 4.6, reviewCount: 112, images: pick4(furnitureImages, 4) },
    { name: 'Bookshelf Unit', description: '5-tier open bookshelf in industrial style with metal frame.', price: 249.99, stock: 20, categoryId: furniture._id, averageRating: 4.4, reviewCount: 178, images: pick4(furnitureImages, 5) },
    { name: 'Accent Armchair', description: 'Mid-century modern accent armchair in velvet upholstery.', price: 399.99, discount: 20, stock: 12, categoryId: furniture._id, averageRating: 4.5, reviewCount: 145, images: pick4(furnitureImages, 6) },
    { name: 'Coffee Table', description: 'Minimalist coffee table with tempered glass top and oak legs.', price: 299.99, stock: 15, categoryId: furniture._id, averageRating: 4.3, reviewCount: 89, images: pick4(furnitureImages, 7) },
    { name: 'Wardrobe with Mirror', description: 'Sliding door wardrobe with full-length mirror and organizer.', price: 849.99, stock: 4, categoryId: furniture._id, averageRating: 4.6, reviewCount: 67, images: pick4(furnitureImages, 8) },
    { name: 'TV Console', description: 'Low-profile TV console in walnut veneer with cable management.', price: 449.99, discount: 12, stock: 9, categoryId: furniture._id, averageRating: 4.4, reviewCount: 123, images: pick4(furnitureImages, 9) },
  ];

  await Product.insertMany(products);
  console.log(`📦 ${products.length} products created (10 per category, 4 images each)`);

  // ── Sample Orders ──────────────────────────────────────────────────────────
  const customer = await User.findOne({ email: 'user@shop.com' });
  const allProducts = await Product.find({}).limit(6).lean();

  if (customer && allProducts.length >= 2) {
    await Order.insertMany([
      {
        customerId: customer._id,
        items: [
          { productId: allProducts[0]._id, quantity: 1, price: allProducts[0].price, name: allProducts[0].name },
          { productId: allProducts[1]._id, quantity: 2, price: allProducts[1].price, name: allProducts[1].name },
        ],
        totalAmount: allProducts[0].price + allProducts[1].price * 2,
        status: 'delivered',
        shippingAddress: { line1: '123 Main St', city: 'Cairo', state: 'Cairo', postalCode: '11511', country: 'Egypt' },
      },
      {
        customerId: customer._id,
        items: [{ productId: allProducts[2]._id, quantity: 1, price: allProducts[2].price, name: allProducts[2].name }],
        totalAmount: allProducts[2].price,
        status: 'processing',
        shippingAddress: { line1: '456 Nile Ave', city: 'Giza', state: 'Giza', postalCode: '12511', country: 'Egypt' },
      },
    ]);
    console.log('📋 Sample orders created');
  }

  await mongoose.disconnect();
  console.log('✅ Seed complete! 60 products across 6 categories.');
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
