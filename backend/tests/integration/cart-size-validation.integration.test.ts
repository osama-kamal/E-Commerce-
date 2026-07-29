/**
 * Regression tests for size selection on cart items.
 *
 * `selectedSize` was accepted verbatim and carried through to the order without
 * ever being compared against the product's `sizes` array. A client could add
 * size "XXXL" — or any arbitrary string — to a product that only offers S and M,
 * and the order would be placed and fulfilled against a size that does not exist.
 *
 * Scope note: this validates the size against the product's declared options. It
 * does NOT introduce per-size inventory — `Product.stock` is still a single
 * scalar, so the platform still cannot tell that M is sold out while L is not.
 * That requires a variants schema and is tracked separately as a feature.
 */

import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { addItem, updateItemQuantity } from '../../src/modules/cart/cart.service';
import { Cart } from '../../src/modules/cart/cart.model';
import { Product } from '../../src/modules/products/product.model';
import { Store } from '../../src/modules/stores/store.model';
import { User } from '../../src/modules/auth/user.model';

jest.mock('../../src/services/email.service', () => ({
  emailService: {
    sendWelcomeEmail: jest.fn(), sendEmail: jest.fn(), verifyConnection: jest.fn(),
  },
}));

let mongod: MongoMemoryServer;
let store: InstanceType<typeof Store>;
let customerId: Types.ObjectId;

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
    Cart.deleteMany({}), Product.deleteMany({}),
    Store.deleteMany({}), User.deleteMany({}),
  ]);

  store = await Store.create({
    name: 'Size Store', slug: 'size-store', ownerId: new Types.ObjectId(),
    isActive: true, subscriptionPlan: 'pro', subscriptionStatus: 'active',
  });
  const customer = await User.create({
    storeId: store._id, email: 's@test.com',
    passwordHash: 'x', role: 'customer', isActive: true,
  });
  customerId = customer._id as Types.ObjectId;
});

async function makeProduct(sizes: string[]) {
  return Product.create({
    storeId: store._id, name: 'Tee', description: 'd',
    price: 20, stock: 10, categoryId: CATEGORY_ID, sizes,
  });
}

const add = (productId: string, size?: string, qty = 1) =>
  addItem(store._id!.toString(), customerId.toString(), productId, qty, size);

// ── Sized products ──────────────────────────────────────────────────────────

describe('products that declare sizes', () => {
  it('accepts a size the product offers', async () => {
    const p = await makeProduct(['S', 'M', 'L']);

    const cart = await add(p._id!.toString(), 'M');

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].selectedSize).toBe('M');
  });

  it('rejects a size the product does not offer', async () => {
    const p = await makeProduct(['S', 'M']);

    await expect(add(p._id!.toString(), 'XXXL')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await Cart.countDocuments({})).toBe(0);
  });

  it('rejects an arbitrary injected string', async () => {
    const p = await makeProduct(['S', 'M']);

    await expect(add(p._id!.toString(), '<script>alert(1)</script>')).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('requires a size when the product offers sizes', async () => {
    const p = await makeProduct(['S', 'M']);

    await expect(add(p._id!.toString(), undefined)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects an invalid size on quantity update too', async () => {
    const p = await makeProduct(['S', 'M']);
    await add(p._id!.toString(), 'S');

    await expect(
      updateItemQuantity(store._id!.toString(), customerId.toString(), p._id!.toString(), 2, 'XL')
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('allows updating quantity for a valid size', async () => {
    const p = await makeProduct(['S', 'M']);
    await add(p._id!.toString(), 'S');

    const cart = await updateItemQuantity(
      store._id!.toString(), customerId.toString(), p._id!.toString(), 3, 'S'
    );

    expect(cart.items[0].quantity).toBe(3);
  });

  it('keeps different sizes as separate cart lines', async () => {
    const p = await makeProduct(['S', 'M']);
    await add(p._id!.toString(), 'S');
    const cart = await add(p._id!.toString(), 'M');

    expect(cart.items).toHaveLength(2);
    expect(cart.items.map((i) => i.selectedSize).sort()).toEqual(['M', 'S']);
  });
});

// ── Unsized products ────────────────────────────────────────────────────────

describe('products with no sizes', () => {
  it('accepts an item with no size', async () => {
    const p = await makeProduct([]);

    const cart = await add(p._id!.toString());
    expect(cart.items).toHaveLength(1);
  });

  it('rejects a size on a product that has none', async () => {
    const p = await makeProduct([]);

    await expect(add(p._id!.toString(), 'M')).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
