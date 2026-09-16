/**
 * Recommendations must never cross a tenant boundary.
 *
 * Not one query in this module filtered on `storeId`. The routes are mounted on
 * the tenant router, so `req.store` was resolved on every request — the service
 * just never asked for it.
 *
 *   • `GET /recommendations/trending` is PUBLIC and unauthenticated, and
 *     returned the highest-rated products on the entire platform. A merchant's
 *     own storefront would advertise its competitors' catalogue.
 *   • `GET /recommendations/personalized` read a customer's orders with no store
 *     filter and recommended products with no store filter. One email address
 *     legitimately holds separate accounts in separate stores — the unique index
 *     is `{storeId, email}` — so purchases in one shop steered another shop's
 *     recommendations.
 *
 * Product-page recommendations were tenant-safe only BY ACCIDENT: they filter on
 * `categoryId` and categories carry a storeId, so scope arrived through the back
 * door. That is why this survived review, and why the assertions below cover the
 * accidentally-safe path too — an accident is not a guarantee.
 *
 * Store B's catalogue is deliberately rated HIGHER than Store A's, so any query
 * sorting by rating without a tenant filter will surface Store B first. A test
 * that only checked "did I get results" would pass against the bug.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { recommendationsService } from '../../src/modules/recommendations/recommendations.service';
import { Product } from '../../src/modules/products/product.model';
import { Order } from '../../src/modules/orders/order.model';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';

let mongod: MongoMemoryServer;

let storeA: InstanceType<typeof Store>;
let storeB: InstanceType<typeof Store>;
let catA: Types.ObjectId;
let catB: Types.ObjectId;
let customerA: Types.ObjectId;
let widgetA: InstanceType<typeof Product>;
let gadgetB: InstanceType<typeof Product>;

const SHIPPING = { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'CO' };

/** Every product name carrying this marker belongs to the OTHER tenant. */
const FOREIGN = 'STORE-B';

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    Product.deleteMany({}), Order.deleteMany({}), Store.deleteMany({}), User.deleteMany({}),
  ]);

  storeA = await Store.create({
    name: 'Store A', slug: 'store-a', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  storeB = await Store.create({
    name: 'Store B', slug: 'store-b', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });

  catA = new Types.ObjectId();
  catB = new Types.ObjectId();

  const customer = await User.create({
    storeId: storeA._id, email: 'shopper@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerA = customer._id as Types.ObjectId;

  // Store A — modestly rated.
  widgetA = await Product.create({
    storeId: storeA._id, name: 'Widget A', description: 'd',
    price: 10, stock: 20, categoryId: catA, averageRating: 4.1, reviewCount: 5,
  });
  await Product.create({
    storeId: storeA._id, name: 'Gizmo A', description: 'd',
    price: 15, stock: 20, categoryId: catA, averageRating: 4.0, reviewCount: 3,
  });

  // Store B — rated HIGHER, so an unscoped sort surfaces it first.
  gadgetB = await Product.create({
    storeId: storeB._id, name: `${FOREIGN} Gadget`, description: 'd',
    price: 99, stock: 20, categoryId: catB, averageRating: 5.0, reviewCount: 500,
  });
  await Product.create({
    storeId: storeB._id, name: `${FOREIGN} Doohickey`, description: 'd',
    price: 88, stock: 20, categoryId: catB, averageRating: 4.9, reviewCount: 400,
  });
});

/**
 * Fails if ANY returned product belongs to a store other than the expected one.
 *
 * Asserts on `storeId`, which is the actual invariant — the FOREIGN name marker
 * is only a labelling convenience for Store B's catalogue and is meaningless
 * when Store B is itself the expected tenant. Leaked names are surfaced in the
 * failure message so a regression reads as "you returned X and Y" rather than
 * "expected 0, got 2".
 */
function expectAllFromStore(
  products: Array<{ storeId: Types.ObjectId; name: string }>,
  expectedStoreId: Types.ObjectId
): void {
  const foreign = products
    .filter((p) => p.storeId.toString() !== expectedStoreId.toString())
    .map((p) => p.name);

  expect(foreign).toEqual([]);
}

// ── Trending: the public, unauthenticated endpoint ────────────────────────────

describe('trending products', () => {
  it("returns only the requesting store's products", async () => {
    const trending = await recommendationsService.getTrendingProducts(
      storeA._id!.toString(), 8
    );

    expect(trending.length).toBeGreaterThan(0);
    expectAllFromStore(trending as never, storeA._id as Types.ObjectId);
  });

  it("does not surface a rival's higher-rated catalogue", async () => {
    // The exact leak: Store B rates 5.0/500 reviews against Store A's 4.1/5, so
    // an unscoped rating sort put the rival's product first on A's storefront.
    const trending = await recommendationsService.getTrendingProducts(
      storeA._id!.toString(), 8
    );

    expect(trending.map((p) => p.name)).not.toContain(`${FOREIGN} Gadget`);
    expect(trending.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Widget A', 'Gizmo A'])
    );
  });

  it('is symmetric — store B does not see store A either', async () => {
    const trending = await recommendationsService.getTrendingProducts(
      storeB._id!.toString(), 8
    );

    expectAllFromStore(trending as never, storeB._id as Types.ObjectId);
    expect(trending.map((p) => p.name)).not.toContain('Widget A');
  });

  it('returns an empty list for a store with no products, not other stores\' products', async () => {
    const emptyStore = await Store.create({
      name: 'Empty', slug: 'empty-store', ownerId: new Types.ObjectId(),
      isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'active',
    });

    // The backfill branch (`products.length < limit`) was the unscoped one that
    // would happily top up from the whole platform.
    const trending = await recommendationsService.getTrendingProducts(
      emptyStore._id!.toString(), 8
    );

    expect(trending).toEqual([]);
  });

  it('refuses to run without a tenant rather than searching every store', async () => {
    await expect(recommendationsService.getTrendingProducts('', 8)).rejects.toThrow(
      /Store context is required/
    );
    await expect(recommendationsService.getTrendingProducts('not-an-id', 8)).rejects.toThrow(
      /Store context is required/
    );
  });
});

// ── Personalized: derived from order history ──────────────────────────────────

describe('personalized recommendations', () => {
  /** Gives the customer a purchase history in the given store. */
  async function purchase(storeId: Types.ObjectId, product: InstanceType<typeof Product>) {
    await Order.create({
      storeId, customerId: customerA,
      items: [{ productId: product._id, name: product.name, price: product.price, quantity: 1 }],
      subtotal: product.price, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
      totalAmount: product.price, currency: 'USD',
      status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
      shippingAddress: SHIPPING,
    });
  }

  it("returns only the requesting store's products", async () => {
    await purchase(storeA._id as Types.ObjectId, widgetA);

    const recs = await recommendationsService.getPersonalizedRecommendations(
      storeA._id!.toString(), customerA.toString(), 8
    );

    expectAllFromStore(recs as never, storeA._id as Types.ObjectId);
  });

  it('ignores the same shopper\'s purchases in a DIFFERENT store', async () => {
    // One address legitimately holds accounts in several stores. History in B
    // must not shape what A recommends, and must not leak B's catalogue into it.
    await purchase(storeB._id as Types.ObjectId, gadgetB);

    const recs = await recommendationsService.getPersonalizedRecommendations(
      storeA._id!.toString(), customerA.toString(), 8
    );

    expectAllFromStore(recs as never, storeA._id as Types.ObjectId);
    expect(recs.map((p) => p.name)).not.toContain(`${FOREIGN} Doohickey`);
  });

  it('falls back to THIS store\'s trending for a shopper new to it', async () => {
    // History in B only — from A's perspective this is a brand-new customer,
    // and the fallback must stay inside A.
    await purchase(storeB._id as Types.ObjectId, gadgetB);

    const recs = await recommendationsService.getPersonalizedRecommendations(
      storeA._id!.toString(), customerA.toString(), 8
    );

    expect(recs.length).toBeGreaterThan(0);
    expectAllFromStore(recs as never, storeA._id as Types.ObjectId);
  });

  it('keeps the top-up path scoped when history is thin', async () => {
    // Few category matches forces the `recommendations.length < limit` branch,
    // which topped up from getTrendingProducts — previously platform-wide.
    await purchase(storeA._id as Types.ObjectId, widgetA);

    const recs = await recommendationsService.getPersonalizedRecommendations(
      storeA._id!.toString(), customerA.toString(), 8
    );

    expectAllFromStore(recs as never, storeA._id as Types.ObjectId);
  });

  it('refuses to run without a tenant', async () => {
    await expect(
      recommendationsService.getPersonalizedRecommendations('', customerA.toString(), 8)
    ).rejects.toThrow(/Store context is required/);
  });
});

// ── Product-page recommendations and the co-purchase scan ─────────────────────

describe('product recommendations', () => {
  it("returns only the requesting store's products", async () => {
    const recs = await recommendationsService.getRecommendations(
      storeA._id!.toString(), widgetA._id.toString(), 6
    );

    expectAllFromStore(recs as never, storeA._id as Types.ObjectId);
  });

  it("treats another tenant's product id as not found", async () => {
    // Previously `Product.findById` ignored the store, so store A could seed
    // recommendations from a product it has no right to read.
    await expect(
      recommendationsService.getRecommendations(
        storeA._id!.toString(), gadgetB._id.toString(), 6
      )
    ).rejects.toThrow(/Product not found/);
  });

  it('does not scan another tenant\'s orders when building co-purchases', async () => {
    // The co-purchase table was built from `Order.find({'items.productId': …})`
    // across EVERY tenant. Give store B an order containing a product id that
    // also exists in store A's basket, and confirm B's history cannot influence
    // A's output.
    await Order.create({
      storeId: storeB._id, customerId: new Types.ObjectId(),
      items: [
        { productId: widgetA._id, name: 'Widget A', price: 10, quantity: 1 },
        { productId: gadgetB._id, name: `${FOREIGN} Gadget`, price: 99, quantity: 1 },
      ],
      subtotal: 109, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
      totalAmount: 109, currency: 'USD',
      status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
      shippingAddress: SHIPPING,
    });

    const recs = await recommendationsService.getRecommendations(
      storeA._id!.toString(), widgetA._id.toString(), 6
    );

    expectAllFromStore(recs as never, storeA._id as Types.ObjectId);
    expect(recs.map((p) => (p as unknown as { name: string }).name))
      .not.toContain(`${FOREIGN} Gadget`);
  });

  it('refuses to run without a tenant', async () => {
    await expect(
      recommendationsService.getRecommendations('', widgetA._id.toString(), 6)
    ).rejects.toThrow(/Store context is required/);
  });
});

// ── The whole surface, in one sweep ───────────────────────────────────────────

describe('no entry point leaks', () => {
  it('every public method returns only store A products for store A', async () => {
    await Order.create({
      storeId: storeA._id, customerId: customerA,
      items: [{ productId: widgetA._id, name: 'Widget A', price: 10, quantity: 1 }],
      subtotal: 10, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
      totalAmount: 10, currency: 'USD',
      status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
      shippingAddress: SHIPPING,
    });

    const storeAId = storeA._id!.toString();
    const results = await Promise.all([
      recommendationsService.getTrendingProducts(storeAId, 8),
      recommendationsService.getPersonalizedRecommendations(storeAId, customerA.toString(), 8),
      recommendationsService.getRecommendations(storeAId, widgetA._id.toString(), 6),
    ]);

    for (const products of results) {
      expectAllFromStore(products as never, storeA._id as Types.ObjectId);
    }
  });
});
