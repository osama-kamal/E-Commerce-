/**
 * One definition of revenue, applied everywhere.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 * Revenue was computed four different ways and no two agreed:
 *
 *   1. the dashboard summed succeeded `Payment.amount / 100`, which excludes
 *      every cash-on-delivery sale because COD creates no Payment row;
 *   2. "top products" summed `price × quantity` — list prices, so a coupon
 *      never reduced it;
 *   3. analytics and the sales report summed `totalAmount − taxTotal`;
 *   4. product performance summed list prices again.
 *
 * None subtracted refunds, so a merchant could refund an entire order and watch
 * their reported revenue not move.
 *
 * The definition now: `totalAmount − tax − refunds`, counted when the order is
 * PAID rather than when it is fulfilled.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { User } from '../../src/modules/auth/user.model';
import { Store } from '../../src/modules/stores/store.model';
import { Refund } from '../../src/modules/refunds/refund.model';
import * as adminService from '../../src/modules/admin/admin.service';
import * as reportsService from '../../src/modules/reports/reports.service';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendEmail: jest.fn(), sendWelcomeEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let product: InstanceType<typeof Product>;
let customer: InstanceType<typeof User>;

const SHIPPING = { line1: '1 St', city: 'C', state: 'S', postalCode: 'P', country: 'GB' };
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
  await Promise.all([
    Order.deleteMany({}), Product.deleteMany({}), User.deleteMany({}),
    Store.deleteMany({}), Refund.deleteMany({}),
  ]);
  // The analytics/admin caches are in-process and keyed per store; a fresh
  // store id per test avoids one case seeing another's cached figures.
  store = await Store.create({
    name: 'S', slug: `s-${Math.random().toString(36).slice(2, 9)}`,
    ownerId: new Types.ObjectId(), isActive: true,
    subscriptionPlan: 'pro', subscriptionStatus: 'active', trialEndsAt: null,
    currency: 'GBP',
  });
  product = await Product.create({
    storeId: store._id, name: 'Widget', description: 'd',
    price: 50, stock: 100, categoryId: CATEGORY_ID, isDeleted: false,
  });
  customer = await User.create({
    storeId: store._id, email: `c${Math.random()}@t.com`,
    passwordHash: 'x', role: 'customer', isActive: true,
  });
});

/** £100 goods + £20 exclusive VAT = £120 charged, unless overridden. */
async function makeOrder(overrides: Record<string, unknown> = {}) {
  return Order.create({
    storeId: store._id,
    customerId: customer._id,
    items: [{ productId: product._id, name: 'Widget', price: 50, quantity: 2 }],
    subtotal: 100,
    discountAmount: 0,
    shippingTotal: 0,
    taxTotal: 20,
    taxLines: [{ name: 'VAT', rate: 20, amount: 20, inclusive: false, appliesToShipping: false }],
    totalAmount: 120,
    refundedTotal: 0,
    currency: 'GBP',
    status: 'delivered',
    paymentStatus: 'paid',
    paymentMethod: 'online',
    shippingAddress: SHIPPING,
    ...overrides,
  });
}

const dashboard = () => adminService.getDashboardStats(store._id!.toString());

describe('the definition', () => {
  it('excludes tax', async () => {
    await makeOrder();
    // £120 charged, £20 of it VAT owed to HMRC — never the merchant's income.
    expect((await dashboard()).totalRevenue).toBe(100);
  });

  it('includes shipping', async () => {
    // Delivery charged to the customer offsets a real carrier cost and is
    // genuine revenue; excluding it would understate the business.
    await makeOrder({ shippingTotal: 10, totalAmount: 130 });
    expect((await dashboard()).totalRevenue).toBe(110);
  });

  it('subtracts refunds', async () => {
    // The gap C5 opened: refunds were recorded but reduced no reported figure.
    // refundedTaxTotal is the tax that went back with the goods.
    await makeOrder({ refundedTotal: 60, refundedTaxTotal: 10, paymentStatus: 'partially_refunded' });
    expect((await dashboard()).totalRevenue).toBe(50); // 100 net earned − 50 net refunded
  });

  it('reports ~zero for a fully refunded order rather than excluding it', async () => {
    // Self-correcting: partial and full refunds are the same arithmetic.
    await makeOrder({ refundedTotal: 120, refundedTaxTotal: 20, paymentStatus: 'refunded' });
    expect((await dashboard()).totalRevenue).toBe(0);
  });
});

describe('recognition — when a sale counts', () => {
  it('counts a cash-on-delivery order once it is paid', async () => {
    // The old dashboard summed Payment rows, and COD creates none — so cash
    // sales were invisible on the screen merchants look at most.
    await makeOrder({ paymentMethod: 'cod', paymentStatus: 'paid' });
    expect((await dashboard()).totalRevenue).toBe(100);
  });

  it('does NOT count a cash-on-delivery order that is still unpaid', async () => {
    // The mirror error: status-based recognition counted COD the moment it was
    // placed, inflating revenue with money that had not arrived.
    await makeOrder({
      paymentMethod: 'cod', paymentStatus: 'unpaid', status: 'processing',
    });
    expect((await dashboard()).totalRevenue).toBe(0);
  });

  it('counts a paid order even after it is cancelled', async () => {
    // Money was taken. It stops counting when refunded, not when the goods
    // are called off — that is what the separate payment axis buys.
    await makeOrder({ status: 'cancelled', paymentStatus: 'paid' });
    expect((await dashboard()).totalRevenue).toBe(100);
  });

  it('counts legacy orders with no paymentStatus exactly as before', async () => {
    // Safe to deploy ahead of migrate:payment-status. Without this fallback
    // every pre-migration order would read as unpaid and revenue would collapse
    // to zero the moment this shipped.
    await Order.collection.insertOne({
      storeId: store._id,
      customerId: customer._id,
      items: [{ productId: product._id, name: 'Old', price: 40, quantity: 1 }],
      totalAmount: 40,
      discountAmount: 0,
      currency: 'GBP',
      status: 'delivered',
      paymentMethod: 'cod',
      shippingAddress: SHIPPING,
      createdAt: new Date(),
      updatedAt: new Date(),
      // no paymentStatus, no taxTotal, no refundedTotal — pre-migration shape
    });

    expect((await dashboard()).totalRevenue).toBe(40);
  });

  it('does not count a legacy order that never left pending', async () => {
    await Order.collection.insertOne({
      storeId: store._id, customerId: customer._id,
      items: [{ productId: product._id, name: 'Old', price: 40, quantity: 1 }],
      totalAmount: 40, discountAmount: 0, currency: 'GBP',
      status: 'pending', paymentMethod: 'cod', shippingAddress: SHIPPING,
      createdAt: new Date(), updatedAt: new Date(),
    });

    expect((await dashboard()).totalRevenue).toBe(0);
  });
});

describe('tenant scoping', () => {
  it('never counts another store\'s orders', async () => {
    const other = await Store.create({
      name: 'Other', slug: `o-${Math.random().toString(36).slice(2, 9)}`,
      ownerId: new Types.ObjectId(), isActive: true,
      subscriptionPlan: 'free', subscriptionStatus: 'active', trialEndsAt: null,
      currency: 'GBP',
    });
    await makeOrder();
    await Order.create({
      storeId: other._id, customerId: new Types.ObjectId(),
      items: [{ productId: new Types.ObjectId(), name: 'X', price: 999, quantity: 1 }],
      subtotal: 999, discountAmount: 0, shippingTotal: 0, taxTotal: 0, taxLines: [],
      totalAmount: 999, refundedTotal: 0, currency: 'GBP',
      status: 'delivered', paymentStatus: 'paid', paymentMethod: 'online',
      shippingAddress: SHIPPING,
    });

    expect((await dashboard()).totalRevenue).toBe(100);
  });
});

describe('currency', () => {
  it('never sums across currencies', async () => {
    // Orders snapshot their currency and nothing used to group by it, so a
    // store that switched currency was adding pounds to dollars.
    await makeOrder();                                   // GBP 100 net
    await makeOrder({ currency: 'USD', totalAmount: 60, taxTotal: 0, subtotal: 60 });

    const stats = await dashboard();

    expect(stats.currency).toBe('GBP');
    expect(stats.totalRevenue).toBe(100); // the store's own currency only
    expect(stats.revenueByCurrency).toHaveLength(2);

    const usd = stats.revenueByCurrency.find(r => r.currency === 'USD');
    expect(usd?.revenue).toBe(60);
  });

  it('breaks out gross, tax and refunds alongside net', async () => {
    await makeOrder({ refundedTotal: 20, refundedTaxTotal: 0, paymentStatus: 'partially_refunded' });
    const [row] = (await dashboard()).revenueByCurrency;

    expect(row).toMatchObject({
      currency: 'GBP', grossCharged: 120, taxCollected: 20, refunded: 20, revenue: 80,
    });
  });
});

describe('every surface agrees', () => {
  it('dashboard and sales report report the same revenue', async () => {
    // The original defect in one assertion: these two screens disagreed because
    // one summed payments and the other summed orders.
    await makeOrder();
    await makeOrder({ paymentMethod: 'cod', paymentStatus: 'paid' });
    await makeOrder({ paymentStatus: 'unpaid', status: 'pending' });

    const stats = await dashboard();
    const report = await reportsService.getSalesReport({
      storeId: store._id!.toString(),
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
      page: 1,
      limit: 50,
    });

    expect(stats.totalRevenue).toBe(200); // two paid orders, tax excluded
    expect(report.summary.totalRevenue).toBe(stats.totalRevenue);
  });

  it('the sales report LIST still shows unpaid orders', async () => {
    // The summary counts money; the list is an order log. Filtering the list
    // would hide orders a merchant needs to chase.
    await makeOrder({ paymentStatus: 'unpaid', status: 'pending' });

    const report = await reportsService.getSalesReport({
      storeId: store._id!.toString(),
      startDate: new Date(Date.now() - 86_400_000),
      endDate: new Date(Date.now() + 86_400_000),
      page: 1, limit: 50,
    });

    expect(report.sales).toHaveLength(1);
    expect(report.summary.totalRevenue).toBe(0);
  });
});

describe('product-level revenue', () => {
  it('prorates the order discount instead of summing list prices', async () => {
    // £100 of goods with a £20 coupon: the customer paid £80, so the product
    // earned £80 — not the £100 the old sum reported.
    await makeOrder({ discountAmount: 20, totalAmount: 100, taxTotal: 0, taxLines: [] });

    const [top] = await adminService.getTopProducts(store._id!.toString());
    expect(top.revenue).toBe(80);
  });

  it('subtracts per-product refunds', async () => {
    const order = await makeOrder({ taxTotal: 0, taxLines: [], totalAmount: 100 });
    await Refund.create({
      storeId: store._id, orderId: order._id, customerId: customer._id,
      lines: [{
        productId: product._id, name: 'Widget', quantity: 1, unitPrice: 50,
        subtotalRefunded: 50, taxRefunded: 0, restocked: true,
      }],
      subtotalRefunded: 50, taxRefunded: 0, shippingRefunded: 0, totalRefunded: 50,
      currency: 'GBP', status: 'succeeded', provider: 'stripe', outOfBand: false,
    });

    const [top] = await adminService.getTopProducts(store._id!.toString());
    expect(top.revenue).toBe(50);
  });

  it('ignores a refund that has not succeeded', async () => {
    // A pending refund may still fail and release its reservation; a failed one
    // returned nothing. Neither should reduce reported revenue yet.
    const order = await makeOrder({ taxTotal: 0, taxLines: [], totalAmount: 100 });
    await Refund.create({
      storeId: store._id, orderId: order._id, customerId: customer._id,
      lines: [{
        productId: product._id, name: 'Widget', quantity: 1, unitPrice: 50,
        subtotalRefunded: 50, taxRefunded: 0, restocked: false,
      }],
      subtotalRefunded: 50, taxRefunded: 0, shippingRefunded: 0, totalRefunded: 50,
      currency: 'GBP', status: 'failed', provider: 'stripe', outOfBand: false,
    });

    const [top] = await adminService.getTopProducts(store._id!.toString());
    expect(top.revenue).toBe(100);
  });
});
