/**
 * Guards that hot collections are indexed for the way this application queries.
 *
 * Every read in a multi-tenant application filters by store first, so an index
 * that does not lead with `storeId` cannot serve it. `create-indexes.ts` used to
 * hand-write six such indexes ({ createdAt, status }, { customerId, createdAt },
 * { categoryId }, { stock }, …) — none of which could be used, all of which
 * still cost write amplification. The script now derives everything from the
 * schemas; these tests pin what those schemas must declare.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { Order } from '../../src/modules/orders/order.model';
import { Product } from '../../src/modules/products/product.model';
import { User } from '../../src/modules/auth/user.model';
import { Review } from '../../src/modules/reviews/review.model';
import { Cart } from '../../src/modules/cart/cart.model';
import { Coupon } from '../../src/modules/coupons/coupon.model';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

/** Index key patterns declared on a schema, as ordered key-name arrays. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function declaredIndexKeys(model: mongoose.Model<any>): string[][] {
  return model.schema.indexes().map(([key]) => Object.keys(key as Record<string, unknown>));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasIndexLeadingWith(model: mongoose.Model<any>, field: string): boolean {
  return declaredIndexKeys(model).some((keys) => keys[0] === field);
}

describe('tenant-scoped indexing', () => {
  it.each([
    ['Order', Order],
    ['Product', Product],
    ['Review', Review],
    ['Cart', Cart],
    ['Coupon', Coupon],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as Array<[string, mongoose.Model<any>]>)(
    '%s declares at least one index leading with storeId',
    (_name, model) => {
      expect(hasIndexLeadingWith(model, 'storeId')).toBe(true);
    }
  );

  it('User is uniquely indexed on (storeId, email) — email is unique per store, not globally', () => {
    const match = User.schema
      .indexes()
      .find(([key]) => {
        const keys = Object.keys(key as Record<string, unknown>);
        return keys[0] === 'storeId' && keys[1] === 'email';
      });

    expect(match).toBeDefined();
    expect(match![1]).toMatchObject({ unique: true });
  });
});

describe('order query paths are covered', () => {
  it('covers a customer listing their own orders (storeId, customerId, createdAt)', () => {
    const keys = declaredIndexKeys(Order);
    expect(keys).toContainEqual(['storeId', 'customerId', 'createdAt']);
  });

  it('covers an admin filtering by status (storeId, status, createdAt)', () => {
    const keys = declaredIndexKeys(Order);
    expect(keys).toContainEqual(['storeId', 'status', 'createdAt']);
  });

  it('covers date-range analytics (storeId, createdAt)', () => {
    const keys = declaredIndexKeys(Order);
    expect(keys).toContainEqual(['storeId', 'createdAt']);
  });

  it('covers the cross-tenant reservation-expiry sweep (status, paymentMethod, createdAt)', () => {
    // expireStalePendingOrders intentionally ignores storeId — it releases
    // abandoned checkouts platform-wide. Without this index it scanned the whole
    // orders collection every 5 minutes.
    const keys = declaredIndexKeys(Order);
    expect(keys).toContainEqual(['status', 'paymentMethod', 'createdAt']);
  });

  it('declares no MULTI-KEY index that omits storeId except the expiry sweep', () => {
    // Single-field indexes (customerId, status, paymentMethod) are declared via
    // `index: true` on the field and are cheap; they are not the concern here.
    // Any other compound omitting storeId would be, because it could only have
    // been designed for a query that ignores tenancy.
    const EXPIRY_SWEEP = ['status', 'paymentMethod', 'createdAt'].join(',');
    const offenders = declaredIndexKeys(Order)
      .filter((keys) => keys.length > 1 && !keys.includes('storeId'))
      .filter((keys) => keys.join(',') !== EXPIRY_SWEEP);
    expect(offenders).toEqual([]);
  });
});

describe('product catalogue indexes', () => {
  it('covers filtered catalogue reads (storeId, isDeleted, categoryId, price)', () => {
    const keys = declaredIndexKeys(Product);
    expect(keys).toContainEqual(['storeId', 'isDeleted', 'categoryId', 'price']);
  });

  it('declares no MULTI-KEY index that omits storeId', () => {
    const offenders = declaredIndexKeys(Product)
      .filter((keys) => keys.length > 1 && !keys.includes('storeId'));
    expect(offenders).toEqual([]);
  });
});

describe('indexes actually build against a real database', () => {
  it('creates every declared index without conflict', async () => {
    // Catches duplicate key patterns under different names, which MongoDB
    // rejects — the exact failure the old hand-written Stripe index calls risked.
    await expect(
      Promise.all([
        Order.createIndexes(),
        Product.createIndexes(),
        User.createIndexes(),
        Review.createIndexes(),
        Cart.createIndexes(),
        Coupon.createIndexes(),
      ])
    ).resolves.toBeDefined();
  });
});
