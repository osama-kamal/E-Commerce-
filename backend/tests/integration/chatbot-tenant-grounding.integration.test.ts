/**
 * The assistant must speak for the store it is actually in.
 *
 * Three faults, all of which shipped:
 *
 *   1. `storeId` was optional on every function, and the queries degraded to
 *      store-less when it was absent (`storeId ? {storeId} : {}`). Nothing
 *      leaked in practice because the route guarantees a tenant — but that is
 *      the same shape that left the recommendations module querying the whole
 *      platform, and it held only because of a promise made elsewhere.
 *
 *   2. The system prompt asserted "Free shipping on orders over $50", "30-day
 *      return policy" and "Secure payments via Stripe" as universal truth, on a
 *      platform where shipping, tax, currency and gateway are all per-store. The
 *      shipping claim got MORE wrong the day per-store shipping shipped, because
 *      there was then real data for it to contradict. It also always said
 *      "across 0 categories" — it read `distinct('category')` and the field is
 *      `categoryId`.
 *
 *   3. Every price was rendered with a hardcoded "$", so an EGP store's
 *      assistant quoted dollars.
 */

process.env.OPENAI_API_KEY = '';   // force the rule-based path unless a test opts in
process.env.RESEND_API_KEY = '';

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { chatbotService } from '../../src/modules/chatbot/chatbot.service';
import { buildStoreContext, renderStoreFacts } from '../../src/modules/chatbot/store-context';
import { cacheService } from '../../src/services/cache.service';
import { Store } from '../../src/modules/stores/store.model';
import { Product } from '../../src/modules/products/product.model';
import { Category } from '../../src/modules/categories/category.model';
import { Order } from '../../src/modules/orders/order.model';
import { User } from '../../src/modules/auth/user.model';
import { ShippingZone, ShippingRate } from '../../src/modules/shipping/shipping.model';
import { TaxRate } from '../../src/modules/tax/tax.model';

let mongod: MongoMemoryServer;

let egpStore: InstanceType<typeof Store>;
let jpyStore: InstanceType<typeof Store>;
let customer: Types.ObjectId;

const SHIPPING_ADDR = { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'EG' };

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  cacheService.clear(); // store context is cached for 5 minutes
  await Promise.all([
    Store.deleteMany({}), Product.deleteMany({}), Category.deleteMany({}),
    Order.deleteMany({}), User.deleteMany({}),
    ShippingZone.deleteMany({}), ShippingRate.deleteMany({}), TaxRate.deleteMany({}),
  ]);

  egpStore = await Store.create({
    name: 'Cairo Threads', slug: 'cairo-threads', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
    currency: 'EGP', pricesIncludeTax: true,
    settings: { contactEmail: 'help@cairothreads.test', contactPhone: '+20 100 000 0000' },
  });

  jpyStore = await Store.create({
    name: 'Tokyo Goods', slug: 'tokyo-goods', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
    currency: 'JPY',
  });

  const shirts = await Category.create({
    storeId: egpStore._id, name: 'Shirts', slug: 'shirts',
  });
  await Category.create({ storeId: egpStore._id, name: 'Trousers', slug: 'trousers' });

  await Product.create({
    storeId: egpStore._id, name: 'Linen Shirt', description: 'd',
    price: 450, stock: 10, categoryId: shirts._id, averageRating: 4.6, reviewCount: 12,
  });

  const jpyCat = await Category.create({
    storeId: jpyStore._id, name: 'Homeware', slug: 'homeware',
  });
  await Product.create({
    storeId: jpyStore._id, name: 'Ceramic Bowl', description: 'd',
    price: 5000, stock: 10, categoryId: jpyCat._id, averageRating: 4.8, reviewCount: 30,
  });

  const user = await User.create({
    storeId: egpStore._id, email: 'shopper@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customer = user._id as Types.ObjectId;
});

// ── 1. storeId is required ────────────────────────────────────────────────────

describe('storeId is strictly required', () => {
  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['not an ObjectId', 'store-a'],
  ])('refuses a %s rather than querying every store', async (_label, badId) => {
    await expect(chatbotService.chat(badId, 'hello')).rejects.toThrow(
      /Store context is required/
    );
  });

  it('refuses at the context builder too', async () => {
    await expect(buildStoreContext('')).rejects.toThrow(/Store context is required/);
  });

  it('404s for a well-formed id that is not a store', async () => {
    await expect(
      chatbotService.chat(new Types.ObjectId().toString(), 'hello')
    ).rejects.toThrow(/Store not found/);
  });
});

// ── 2. Grounded in the real store record ──────────────────────────────────────

describe('store context reflects the actual store', () => {
  it('reports the real category names, not zero', async () => {
    // `distinct('category')` targeted a field that does not exist, so the prompt
    // always claimed "0 categories" for every store on the platform.
    const ctx = await buildStoreContext(egpStore._id!.toString());

    expect(ctx.productCount).toBe(1);
    expect(ctx.categoryNames.sort()).toEqual(['Shirts']);
    expect(ctx.categoryNames.length).toBeGreaterThan(0);
  });

  it('carries the store currency, name and contact details', async () => {
    const ctx = await buildStoreContext(egpStore._id!.toString());

    expect(ctx.storeName).toBe('Cairo Threads');
    expect(ctx.currency).toBe('EGP');
    expect(ctx.pricesIncludeTax).toBe(true);
    expect(ctx.contactEmail).toBe('help@cairothreads.test');
  });

  it('reports shipping as unconfigured when the merchant has no zones', async () => {
    const ctx = await buildStoreContext(egpStore._id!.toString());
    expect(ctx.shipping.configured).toBe(false);

    const facts = renderStoreFacts(ctx);
    expect(facts).toContain('not configured');
    expect(facts).not.toMatch(/free delivery on orders over/i);
  });

  it('states real shipping figures once the merchant configures them', async () => {
    const zone = await ShippingZone.create({
      storeId: egpStore._id, name: 'Egypt', countries: ['EG'], isActive: true,
    });
    await ShippingRate.create({
      storeId: egpStore._id, zoneId: zone._id, name: 'Standard',
      type: 'flat', flatAmount: 60, freeOverThreshold: 1000, isActive: true,
    });
    cacheService.clear();

    const ctx = await buildStoreContext(egpStore._id!.toString());
    const facts = renderStoreFacts(ctx);

    expect(ctx.shipping.configured).toBe(true);
    expect(facts).toContain('EG');
    // Real numbers, in the store's currency — not "$50".
    expect(facts).toContain('EGP');
    expect(facts).toMatch(/Free delivery on orders over/);
    expect(facts).not.toContain('$50');
  });

  it('names the tax rates in force and whether they are included', async () => {
    await TaxRate.create({
      storeId: egpStore._id, name: 'VAT', rate: 14, country: 'EG', isActive: true,
    });
    cacheService.clear();

    const facts = renderStoreFacts(await buildStoreContext(egpStore._id!.toString()));
    expect(facts).toContain('VAT');
    expect(facts).toContain('included in listed prices');
  });

  it('does not leak another store into the context', async () => {
    const ctx = await buildStoreContext(egpStore._id!.toString());

    expect(ctx.productCount).toBe(1);           // not 2
    expect(ctx.categoryNames).not.toContain('Homeware');
    expect(ctx.storeName).not.toBe('Tokyo Goods');
  });
});

// ── 3. No invented facts ──────────────────────────────────────────────────────

describe('the assistant does not invent policy', () => {
  it('refers returns questions to the store instead of claiming 30 days', async () => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'what is your return policy?');

    expect(reply).not.toMatch(/30-day|30 day/i);
    expect(reply).not.toMatch(/free returns/i);
    expect(reply).toContain('help@cairothreads.test');
  });

  it('does not claim a shipping threshold the store never set', async () => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'how much is shipping?');

    expect(reply).not.toContain('$50');
    expect(reply).not.toMatch(/free shipping on orders over \$/i);
    expect(reply).toContain('help@cairothreads.test');
  });

  it('does not name a payment provider the store may not use', async () => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'how can I pay?');

    // Paymob-settled stores never touch Stripe; the old reply named it anyway.
    expect(reply).not.toMatch(/stripe/i);
    expect(reply).toContain('EGP');
  });

  it('quotes real shipping once configured', async () => {
    const zone = await ShippingZone.create({
      storeId: egpStore._id, name: 'Egypt', countries: ['EG'], isActive: true,
    });
    await ShippingRate.create({
      storeId: egpStore._id, zoneId: zone._id, name: 'Standard',
      type: 'flat', flatAmount: 60, freeOverThreshold: 1000, isActive: true,
    });
    cacheService.clear();

    const reply = await chatbotService.chat(egpStore._id!.toString(), 'how much is shipping?');

    expect(reply).toContain('Standard');
    expect(reply).toContain('EGP');
    expect(reply).not.toContain('$');
  });
});

// ── 4. Currency ───────────────────────────────────────────────────────────────

describe('prices are quoted in the store currency', () => {
  it('renders an EGP catalogue in EGP, never dollars', async () => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'show me products');

    expect(reply).toContain('Linen Shirt');
    expect(reply).toContain('EGP');
    expect(reply).not.toContain('$450');
  });

  it('renders a zero-decimal currency with no sub-unit', async () => {
    // ¥5,000 has no minor unit — the old code printed "$5000.00".
    const reply = await chatbotService.chat(jpyStore._id!.toString(), 'show me products');

    expect(reply).toContain('Ceramic Bowl');
    expect(reply).toContain('¥5,000');
    expect(reply).not.toContain('5000.00');
    expect(reply).not.toContain('$');
  });

  it("quotes an order in the currency it was PLACED in", async () => {
    // Orders snapshot their currency. A store that later switched must not have
    // its history restated in the new one.
    await Order.create({
      storeId: egpStore._id, customerId: customer,
      items: [{ productId: new Types.ObjectId(), name: 'Linen Shirt', price: 450, quantity: 1 }],
      subtotal: 450, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
      totalAmount: 450, currency: 'EGP',
      status: 'processing', paymentStatus: 'paid', paymentMethod: 'online',
      shippingAddress: SHIPPING_ADDR,
    });

    const reply = await chatbotService.chat(
      egpStore._id!.toString(), 'where is my order?', customer.toString()
    );

    expect(reply).toContain('EGP');
    expect(reply).not.toContain('$450');
  });
});

// ── 5. Tenant isolation of the data the assistant can reach ───────────────────

describe('tenant isolation', () => {
  it("never surfaces another store's products", async () => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'show me products');

    expect(reply).not.toContain('Ceramic Bowl');
    expect(reply).toContain('Linen Shirt');
  });

  it("never surfaces a customer's orders from another store", async () => {
    // Same person, order placed in the OTHER store.
    await Order.create({
      storeId: jpyStore._id, customerId: customer,
      items: [{ productId: new Types.ObjectId(), name: 'Ceramic Bowl', price: 5000, quantity: 1 }],
      subtotal: 5000, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
      totalAmount: 5000, currency: 'JPY',
      status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
      shippingAddress: SHIPPING_ADDR,
    });

    const reply = await chatbotService.chat(
      egpStore._id!.toString(), 'track my order', customer.toString()
    );

    expect(reply).toMatch(/don't have any orders yet/i);
    expect(reply).not.toContain('5,000');
  });

  it('greets with the correct store name', async () => {
    const egp = await chatbotService.chat(egpStore._id!.toString(), 'hello');
    const jpy = await chatbotService.chat(jpyStore._id!.toString(), 'hello');

    expect(egp).toContain('Cairo Threads');
    expect(egp).not.toContain('Tokyo Goods');
    expect(jpy).toContain('Tokyo Goods');
  });
});

// ── 6. Keyword matching is whole-word ─────────────────────────────────────────
//
// `matchesAny` used naive substring matching, and the greeting list contains
// "hi". Because greetings are checked first, any question containing those two
// letters inside another word — s-HI-pping, t-HI-s, w-HI-ch — was answered with
// "Hello! Welcome to …" instead of reaching its own branch. That single bug hid
// the shipping, returns and payment answers.

describe('keyword matching does not fire inside other words', () => {
  it.each([
    ['how much is shipping?', 'shipping', /Delivery|delivery details/],
    ['what is this return policy?', 'return', /returns policy/i],
    ['which payment methods work?', 'payment', /Checkout is secure/],
  ])('%s routes to the %s branch, not the greeting', async (message, _topic, expected) => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), message);

    expect(reply).not.toContain('👋 Hello!');
    expect(reply).toMatch(expected);
  });

  it('still greets on a real greeting', async () => {
    for (const greeting of ['hi', 'hello there', 'hey', 'Hi!']) {
      const reply = await chatbotService.chat(egpStore._id!.toString(), greeting);
      expect(reply).toContain('👋 Hello!');
    }
  });

  it('still matches Arabic keywords, where \\b would not', async () => {
    // `\b` is defined on [A-Za-z0-9_], so a space-to-Arabic transition is
    // non-word to non-word and yields no boundary. Unicode property escapes do.
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'مرحبا');
    expect(reply).toContain('👋 Hello!');
  });

  it('still matches multi-word phrases', async () => {
    const reply = await chatbotService.chat(egpStore._id!.toString(), 'I am looking for a shirt');
    expect(reply).toContain('Linen Shirt');
  });

  it('matches plurals, which strict whole-word matching would miss', async () => {
    for (const message of ['show me products', 'any offers?', 'what deals do you have']) {
      const reply = await chatbotService.chat(egpStore._id!.toString(), message);
      expect(reply).not.toContain("I'm not sure I understand");
    }
  });

  it('does not let a short keyword hijack a longer word', async () => {
    // "history" starts with "hi"; a leading-boundary-only rule would greet the
    // customer instead of answering about their orders.
    const reply = await chatbotService.chat(
      egpStore._id!.toString(), 'show my order history', customer.toString()
    );
    expect(reply).not.toContain('👋 Hello!');
  });
});
