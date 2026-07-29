/**
 * Regression tests for two scalability/correctness defects.
 *
 * A. getProductReviews loaded EVERY review for a product into memory with no
 *    pagination and averaged them in JavaScript. A product with tens of
 *    thousands of reviews would ship the whole set on a public endpoint.
 *
 * B. Product search anchored the pattern at the start of the field:
 *
 *        new RegExp('^' + escaped, 'i')
 *
 *    so searching "shirt" did not match "Blue Shirt" — only products whose name
 *    or description BEGAN with the term. For a storefront search box that is
 *    simply wrong.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { getProductReviews } from '../../src/modules/reviews/review.service';
import { listProducts } from '../../src/modules/products/product.service';
import { Review } from '../../src/modules/reviews/review.model';
import { Product } from '../../src/modules/products/product.model';
import { Store } from '../../src/modules/stores/store.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let product: InstanceType<typeof Product>;

const CATEGORY_ID = new Types.ObjectId();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([Review.deleteMany({}), Product.deleteMany({}), Store.deleteMany({})]);

  store = await Store.create({
    name: 'RS Store', slug: 'rs-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  product = await Product.create({
    storeId: store._id, name: 'Reviewed Item', description: 'd',
    price: 20, stock: 5, categoryId: CATEGORY_ID,
  });
});

async function seedReviews(n: number) {
  await Review.insertMany(
    Array.from({ length: n }, (_, i) => ({
      storeId: store._id,
      productId: product._id,
      customerId: new Types.ObjectId(),
      rating: (i % 5) + 1,
      comment: `review ${i}`,
    }))
  );
}

// ── A. Review pagination ────────────────────────────────────────────────────

describe('getProductReviews pagination', () => {
  it('returns only the requested page', async () => {
    await seedReviews(30);

    const res = await getProductReviews(store._id!.toString(), product._id!.toString(), 1, 10);

    expect(res.reviews).toHaveLength(10);
  });

  it('reports the full total, not the page size', async () => {
    await seedReviews(30);

    const res = await getProductReviews(store._id!.toString(), product._id!.toString(), 1, 10);

    expect(res.total).toBe(30);
  });

  it('returns different reviews on page 2', async () => {
    await seedReviews(30);

    const p1 = await getProductReviews(store._id!.toString(), product._id!.toString(), 1, 10);
    const p2 = await getProductReviews(store._id!.toString(), product._id!.toString(), 2, 10);

    const ids1 = p1.reviews.map((r) => r._id.toString());
    const ids2 = p2.reviews.map((r) => r._id.toString());
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it('averages over ALL reviews, not just the current page', async () => {
    // 10 ratings of 5, 10 of 1 -> true average 3. A page-local average would
    // report 5 or 1 depending on the page.
    await Review.insertMany([
      ...Array.from({ length: 10 }, () => ({
        storeId: store._id, productId: product._id,
        customerId: new Types.ObjectId(), rating: 5, comment: 'great',
      })),
      ...Array.from({ length: 10 }, () => ({
        storeId: store._id, productId: product._id,
        customerId: new Types.ObjectId(), rating: 1, comment: 'bad',
      })),
    ]);

    const res = await getProductReviews(store._id!.toString(), product._id!.toString(), 1, 5);

    expect(res.reviews).toHaveLength(5);
    expect(res.averageRating).toBe(3);
  });

  it('caps an oversized limit', async () => {
    await seedReviews(200);

    const res = await getProductReviews(store._id!.toString(), product._id!.toString(), 1, 10_000);

    expect(res.reviews.length).toBeLessThanOrEqual(100);
  });

  it('excludes soft-deleted reviews from both list and total', async () => {
    await seedReviews(5);
    await Review.updateMany({}, { isDeleted: true });

    const res = await getProductReviews(store._id!.toString(), product._id!.toString(), 1, 20);

    expect(res.reviews).toHaveLength(0);
    expect(res.total).toBe(0);
    expect(res.averageRating).toBe(0);
  });

  it('defaults to a sane page size when none is given', async () => {
    await seedReviews(50);

    const res = await getProductReviews(store._id!.toString(), product._id!.toString());

    expect(res.reviews.length).toBeGreaterThan(0);
    expect(res.reviews.length).toBeLessThan(50);
    expect(res.total).toBe(50);
  });
});

// ── B. Search matches anywhere in the field ─────────────────────────────────

describe('product search', () => {
  beforeEach(async () => {
    await Product.deleteMany({});
    await Product.insertMany([
      { storeId: store._id, name: 'Blue Shirt', description: 'cotton', price: 10, stock: 5, categoryId: CATEGORY_ID },
      { storeId: store._id, name: 'Shirt Holder', description: 'plastic', price: 5, stock: 5, categoryId: CATEGORY_ID },
      { storeId: store._id, name: 'Red Hat', description: 'a nice shirt-like hat', price: 8, stock: 5, categoryId: CATEGORY_ID },
      { storeId: store._id, name: 'Trousers', description: 'denim', price: 20, stock: 5, categoryId: CATEGORY_ID },
    ]);
  });

  const search = (term: string) =>
    listProducts({ storeId: store._id!.toString(), page: 1, limit: 20, search: term });

  it('matches a term in the MIDDLE of the name', async () => {
    const res = await search('Shirt');
    const names = res.data.map((p) => p.name).sort();

    // "Blue Shirt" was previously missed because the pattern was ^-anchored.
    expect(names).toContain('Blue Shirt');
    expect(names).toContain('Shirt Holder');
  });

  it('still matches a term at the start', async () => {
    const res = await search('Shirt');
    expect(res.data.map((p) => p.name)).toContain('Shirt Holder');
  });

  it('matches within the description', async () => {
    const res = await search('shirt-like');
    expect(res.data.map((p) => p.name)).toContain('Red Hat');
  });

  it('is case-insensitive', async () => {
    const res = await search('sHiRt');
    expect(res.data.length).toBeGreaterThanOrEqual(2);
  });

  it('excludes non-matching products', async () => {
    const res = await search('Shirt');
    expect(res.data.map((p) => p.name)).not.toContain('Trousers');
  });

  it('treats regex metacharacters literally', async () => {
    const res = await search('.*');
    // Must not behave as a wildcard matching everything.
    expect(res.data).toHaveLength(0);
  });

  it('returns everything when no search term is given', async () => {
    const res = await listProducts({ storeId: store._id!.toString(), page: 1, limit: 20 });
    expect(res.data).toHaveLength(4);
  });
});
