/**
 * Regression tests for verified-purchase enforcement on reviews.
 *
 * The check was gated on NODE_ENV:
 *
 *     const isDev = process.env.NODE_ENV !== 'production';
 *     if (!isDev) { ...require a delivered order... }
 *
 * Any environment where NODE_ENV was unset, misspelled, or set to anything other
 * than exactly 'production' silently allowed ANY authenticated customer to
 * review ANY product — direct ranking and social-proof manipulation. Forgetting
 * one environment variable should not disable a security control.
 *
 * Enforcement is now driven by an explicit, default-on config flag.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { config } from '../../src/config/index';
import { submitReview } from '../../src/modules/reviews/review.service';
import { Review } from '../../src/modules/reviews/review.model';
import { Product } from '../../src/modules/products/product.model';
import { Order } from '../../src/modules/orders/order.model';
import { Store } from '../../src/modules/stores/store.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let product: InstanceType<typeof Product>;
let customerId: Types.ObjectId;

const originalFlag = config.ALLOW_UNVERIFIED_REVIEWS;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  (config as { ALLOW_UNVERIFIED_REVIEWS: boolean }).ALLOW_UNVERIFIED_REVIEWS = originalFlag;
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Default posture: enforcement ON.
  (config as { ALLOW_UNVERIFIED_REVIEWS: boolean }).ALLOW_UNVERIFIED_REVIEWS = false;

  await Promise.all([
    Review.deleteMany({}), Product.deleteMany({}),
    Order.deleteMany({}), Store.deleteMany({}),
  ]);

  store = await Store.create({
    name: 'Rev Store', slug: 'rev-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'free', subscriptionStatus: 'trialing',
  });
  product = await Product.create({
    storeId: store._id, name: 'Reviewed', description: 'd',
    price: 20, stock: 5, categoryId: new Types.ObjectId(),
  });
  customerId = new Types.ObjectId();
});

async function makeDeliveredOrder() {
  return Order.create({
    storeId: store._id,
    customerId,
    items: [{ productId: product._id, name: 'Reviewed', price: 20, quantity: 1 }],
    totalAmount: 20,
    status: 'delivered',
    shippingAddress: { line1: 'a', city: 'b', state: 'c', postalCode: 'd', country: 'e' },
  });
}

const doSubmit = () =>
  submitReview(
    store._id!.toString(), customerId.toString(), product._id!.toString(), 5, 'Great!'
  );

// ── Enforcement is on by default ────────────────────────────────────────────

describe('verified purchase enforcement', () => {
  it('rejects a review from a customer with no delivered order', async () => {
    await expect(doSubmit()).rejects.toMatchObject({ statusCode: 403 });
    expect(await Review.countDocuments({})).toBe(0);
  });

  it('rejects when the order exists but is not delivered', async () => {
    await Order.create({
      storeId: store._id,
      customerId,
      items: [{ productId: product._id, name: 'Reviewed', price: 20, quantity: 1 }],
      totalAmount: 20,
      status: 'shipped',
      shippingAddress: { line1: 'a', city: 'b', state: 'c', postalCode: 'd', country: 'e' },
    });

    await expect(doSubmit()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects when the delivered order is for a different product', async () => {
    const other = await Product.create({
      storeId: store._id, name: 'Other', description: 'd',
      price: 5, stock: 1, categoryId: new Types.ObjectId(),
    });
    await Order.create({
      storeId: store._id,
      customerId,
      items: [{ productId: other._id, name: 'Other', price: 5, quantity: 1 }],
      totalAmount: 5,
      status: 'delivered',
      shippingAddress: { line1: 'a', city: 'b', state: 'c', postalCode: 'd', country: 'e' },
    });

    await expect(doSubmit()).rejects.toMatchObject({ statusCode: 403 });
  });

  it('is NOT bypassed when NODE_ENV is not "production"', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      await expect(doSubmit()).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('is NOT bypassed when NODE_ENV is unset entirely', async () => {
    const prev = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      await expect(doSubmit()).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

// ── Legitimate reviews still work ───────────────────────────────────────────

describe('legitimate reviews', () => {
  it('accepts a review backed by a delivered order', async () => {
    await makeDeliveredOrder();

    const review = await doSubmit();
    expect(review.rating).toBe(5);
    expect(await Review.countDocuments({})).toBe(1);
  });

  it('updates the denormalised product rating', async () => {
    await makeDeliveredOrder();
    await doSubmit();

    const after = await Product.findById(product._id).lean();
    expect(after!.averageRating).toBe(5);
    expect(after!.reviewCount).toBe(1);
  });

  it('rejects a duplicate review from the same customer', async () => {
    await makeDeliveredOrder();
    await doSubmit();

    await expect(doSubmit()).rejects.toMatchObject({ statusCode: 409 });
  });

  it('404s for a product that does not exist in this store', async () => {
    await makeDeliveredOrder();

    await expect(
      submitReview(store._id!.toString(), customerId.toString(), new Types.ObjectId().toString(), 5, 'x')
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── Explicit opt-out for seeding/demo environments ──────────────────────────

describe('ALLOW_UNVERIFIED_REVIEWS opt-out', () => {
  it('permits an unverified review only when explicitly enabled', async () => {
    (config as { ALLOW_UNVERIFIED_REVIEWS: boolean }).ALLOW_UNVERIFIED_REVIEWS = true;

    const review = await doSubmit();
    expect(review.rating).toBe(5);
  });

  it('defaults to false so the control is on unless deliberately disabled', () => {
    expect(originalFlag).toBe(false);
  });
});
