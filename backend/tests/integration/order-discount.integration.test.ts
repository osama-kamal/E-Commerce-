/**
 * Regression tests for the client-supplied-discount vulnerability.
 *
 * Before the fix, `placeOrder` accepted a `discountAmount` from the request body
 * and subtracted it from the server-computed total, so any caller could post
 * `{ discountAmount: 999999 }` and receive an order with totalAmount = 0.
 *
 * These tests pin the corrected contract:
 *   1. The HTTP schema no longer accepts `discountAmount` (it is stripped).
 *   2. The discount actually written to the order is derived from the coupon.
 *   3. A discount can never drive the total below zero.
 *   4. An absent coupon always yields a zero discount / full price.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { placeOrderSchema } from '../../src/modules/orders/order.schemas';
import { placeOrder } from '../../src/modules/orders/order.service';
import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { Cart } from '../../src/modules/cart/cart.model';
import { Coupon } from '../../src/modules/coupons/coupon.model';

// The service fires a welcome/confirmation email and looks up the customer.
// Stub the email transport so tests never touch the network.
jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendOrderConfirmationEmail: jest.fn(),
    sendWelcomeEmail: jest.fn(),
    sendOrderStatusEmail: jest.fn(),
    verifyConnection: jest.fn(),
  },
}));

let replSet: MongoMemoryReplSet;

const STORE_ID = new Types.ObjectId();
const CUSTOMER_ID = new Types.ObjectId();
const CATEGORY_ID = new Types.ObjectId();

const SHIPPING = {
  line1: '1 Test St',
  city: 'Cairo',
  state: 'Cairo',
  postalCode: '11511',
  country: 'EG',
};

beforeAll(async () => {
  // A replica set is required because placeOrder's primary path uses
  // session.withTransaction().
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

beforeEach(async () => {
  await Promise.all([
    Order.deleteMany({}),
    Product.deleteMany({}),
    Cart.deleteMany({}),
    Coupon.deleteMany({}),
  ]);
});

/** Seeds one product priced at $100 with stock, plus a cart holding 1 unit. */
async function seedCartWithHundredDollarProduct(quantity = 1) {
  const product = await Product.create({
    storeId: STORE_ID,
    name: 'Test Product',
    description: 'A product',
    price: 100,
    discount: 0,
    stock: 50,
    categoryId: CATEGORY_ID,
  });

  await Cart.create({
    storeId: STORE_ID,
    customerId: CUSTOMER_ID,
    items: [{ productId: product._id, quantity, priceSnapshot: 100 }],
  });

  return product;
}

// ── 1. The HTTP contract no longer accepts a client discount ────────────────

describe('placeOrderSchema', () => {
  it('strips a client-supplied discountAmount instead of honouring it', () => {
    const parsed = placeOrderSchema.parse({
      body: {
        shippingAddress: SHIPPING,
        paymentMethod: 'cod',
        discountAmount: 999999,
        couponCode: 'SAVE10',
      },
      params: {},
      query: {},
    });

    expect(parsed.body).not.toHaveProperty('discountAmount');
    expect(parsed.body.couponCode).toBe('SAVE10');
  });

  it('still accepts a well-formed order without a coupon', () => {
    const parsed = placeOrderSchema.parse({
      body: { shippingAddress: SHIPPING, paymentMethod: 'online' },
      params: {},
      query: {},
    });

    expect(parsed.body.paymentMethod).toBe('online');
    expect(parsed.body.couponCode).toBeUndefined();
  });
});

// ── 2-4. The service derives the discount itself ─────────────────────────────

describe('placeOrder — server-authoritative discount', () => {
  it('charges full price when no coupon is supplied', async () => {
    await seedCartWithHundredDollarProduct();

    const order = await placeOrder(
      STORE_ID.toString(),
      CUSTOMER_ID.toString(),
      SHIPPING,
      'cod'
    );

    expect(order.totalAmount).toBe(100);
    expect((order as unknown as { discountAmount: number }).discountAmount).toBe(0);
  });

  it('applies the discount defined on the coupon, not one chosen by the caller', async () => {
    await seedCartWithHundredDollarProduct();
    await Coupon.create({
      storeId: STORE_ID,
      code: 'SAVE10',
      type: 'percent',
      discount: 10,
      minOrderAmount: 0,
      maxUses: 0,
    });

    const order = await placeOrder(
      STORE_ID.toString(),
      CUSTOMER_ID.toString(),
      SHIPPING,
      'cod',
      'SAVE10'
    );

    // 10% off $100 — derived from the Coupon document.
    expect(order.totalAmount).toBe(90);
    expect((order as unknown as { discountAmount: number }).discountAmount).toBe(10);
  });

  it('claims a coupon use exactly once per successful order', async () => {
    await seedCartWithHundredDollarProduct();
    await Coupon.create({
      storeId: STORE_ID,
      code: 'SAVE10',
      type: 'percent',
      discount: 10,
      minOrderAmount: 0,
      maxUses: 0,
    });

    await placeOrder(STORE_ID.toString(), CUSTOMER_ID.toString(), SHIPPING, 'cod', 'SAVE10');

    const coupon = await Coupon.findOne({ storeId: STORE_ID, code: 'SAVE10' }).lean();
    expect(coupon!.usedCount).toBe(1);
  });

  it('never lets a fixed coupon larger than the cart drive the total negative', async () => {
    await seedCartWithHundredDollarProduct();
    await Coupon.create({
      storeId: STORE_ID,
      code: 'HUGE',
      type: 'fixed',
      discount: 100000,
      minOrderAmount: 0,
      maxUses: 0,
    });

    const order = await placeOrder(
      STORE_ID.toString(),
      CUSTOMER_ID.toString(),
      SHIPPING,
      'cod',
      'HUGE'
    );

    expect(order.totalAmount).toBe(0);
    expect(order.totalAmount).toBeGreaterThanOrEqual(0);
  });

  it('rejects the order when the coupon does not exist', async () => {
    await seedCartWithHundredDollarProduct();

    await expect(
      placeOrder(STORE_ID.toString(), CUSTOMER_ID.toString(), SHIPPING, 'cod', 'NOPE')
    ).rejects.toMatchObject({ statusCode: 404 });

    // No order may be persisted when coupon resolution fails.
    expect(await Order.countDocuments({})).toBe(0);
  });

  it('does not burn a coupon use when the order fails after claiming it', async () => {
    // Cart references a product with insufficient stock -> validateAndBuild throws
    // inside the transaction, which must roll the usedCount increment back.
    const product = await Product.create({
      storeId: STORE_ID,
      name: 'Scarce',
      description: 'Almost gone',
      price: 100,
      discount: 0,
      stock: 1,
      categoryId: CATEGORY_ID,
    });
    await Cart.create({
      storeId: STORE_ID,
      customerId: CUSTOMER_ID,
      items: [{ productId: product._id, quantity: 5, priceSnapshot: 100 }],
    });
    await Coupon.create({
      storeId: STORE_ID,
      code: 'SAVE10',
      type: 'percent',
      discount: 10,
      minOrderAmount: 0,
      maxUses: 0,
    });

    await expect(
      placeOrder(STORE_ID.toString(), CUSTOMER_ID.toString(), SHIPPING, 'cod', 'SAVE10')
    ).rejects.toThrow(/Insufficient stock/);

    const coupon = await Coupon.findOne({ storeId: STORE_ID, code: 'SAVE10' }).lean();
    expect(coupon!.usedCount).toBe(0);
  });
});
