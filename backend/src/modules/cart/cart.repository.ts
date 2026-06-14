/**
 * CartRepository
 *
 * Owns all direct Mongoose queries for the Cart collection.
 * Services import from here — not from the model directly.
 * No business logic lives here; only data access.
 */

import { Types } from 'mongoose';
import { Cart } from './cart.model';

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function findCart(storeId: Types.ObjectId, customerId: Types.ObjectId) {
  return Cart.findOne({ storeId, customerId }).lean();
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function upsertPushItem(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  item: {
    productId: Types.ObjectId;
    quantity: number;
    priceSnapshot: number;
    selectedSize: string | null;
  }
) {
  return Cart.findOneAndUpdate(
    { storeId, customerId },
    { $push: { items: item } },
    { upsert: true }
  );
}

export async function pushItemFallback(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  item: {
    productId: Types.ObjectId;
    quantity: number;
    priceSnapshot: number;
    selectedSize: string | null;
  }
) {
  return Cart.updateOne(
    { storeId, customerId },
    { $push: { items: item } }
  );
}

export async function incrementItemQuantity(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  productId: Types.ObjectId,
  selectedSize: string | null,
  qty: number,
  priceSnapshot: number
) {
  return Cart.updateOne(
    {
      storeId,
      customerId,
      items: { $elemMatch: { productId, selectedSize } },
    },
    {
      $inc: { 'items.$.quantity': qty },
      $set: { 'items.$.priceSnapshot': priceSnapshot },
    }
  );
}

export async function setItemQuantity(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  productId: Types.ObjectId,
  selectedSize: string | null,
  quantity: number,
  priceSnapshot: number
) {
  return Cart.updateOne(
    {
      storeId,
      customerId,
      items: { $elemMatch: { productId, selectedSize } },
    },
    { $set: { 'items.$.quantity': quantity, 'items.$.priceSnapshot': priceSnapshot } }
  );
}

export async function pullItem(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  pullFilter: Record<string, unknown>
) {
  return Cart.updateOne({ storeId, customerId }, { $pull: { items: pullFilter } });
}

export async function clearItems(storeId: Types.ObjectId, customerId: Types.ObjectId) {
  return Cart.updateOne({ storeId, customerId }, { $set: { items: [] } });
}
