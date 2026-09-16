import { Types } from 'mongoose';
import {
  ShippingZone,
  ShippingRate,
  IShippingZone,
  IShippingRate,
  calculateShippingAmount,
} from './shipping.model';
import { createError } from '../../middleware/errorHandler';

/**
 * Shipping zone and rate resolution.
 *
 * The invariant this module exists to hold: **the client never supplies a
 * shipping amount.** It sends a rate ID; the server re-derives the price from
 * the rate record and the server-side cart subtotal. `resolveSelectedRate`
 * below is the single funnel through which a chosen rate becomes money, and it
 * re-checks that the rate is genuinely offered for the destination — otherwise
 * a customer in an expensive zone could quote a cheap zone's rate ID.
 */

export interface DestinationAddress {
  country: string;
  state?: string;
}

export interface ShippingOption {
  rateId: string;
  name: string;
  description?: string;
  amount: number;
}

/** Uppercased ISO-2, or '' when absent. */
function normaliseCountry(value: string | undefined | null): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Finds the zone serving a destination.
 *
 * An explicitly listed country always beats the `'*'` catch-all, so a merchant
 * can price the UK specifically while still offering rest-of-world delivery.
 * Among equally specific matches, the lowest `sortOrder` wins, giving the
 * merchant a deterministic tie-break they control.
 *
 * Returns `null` when the store does not ship there at all.
 */
export async function matchZone(
  storeId: Types.ObjectId,
  address: DestinationAddress
): Promise<IShippingZone | null> {
  const country = normaliseCountry(address.country);
  if (!country) return null;

  const zones = await ShippingZone.find({ storeId, isActive: true })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean<IShippingZone[]>();

  const exact = zones.find((z) => z.countries.includes(country));
  if (exact) return exact;

  return zones.find((z) => z.countries.includes('*')) ?? null;
}

/**
 * Delivery options available to a destination, priced against `subtotal`.
 *
 * `subtotal` must be the DISCOUNTED goods total so a coupon can legitimately
 * carry an order over a free-shipping threshold.
 *
 * An empty array means "we do not ship there" — the caller decides whether that
 * is a hard checkout failure or simply no options to show.
 */
export async function getShippingOptions(
  storeId: Types.ObjectId,
  address: DestinationAddress,
  subtotal: number
): Promise<ShippingOption[]> {
  const zone = await matchZone(storeId, address);
  if (!zone) return [];

  const rates = await ShippingRate.find({
    storeId,
    zoneId: zone._id,
    isActive: true,
  })
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean<IShippingRate[]>();

  return rates.map((rate) => ({
    rateId: rate._id.toString(),
    name: rate.name,
    description: rate.description,
    amount: calculateShippingAmount(rate, subtotal),
  }));
}

/**
 * How many active zones this store has.
 *
 * Distinguishes "shipping is not configured" (0 — charge nothing and let the
 * order through, which is every store that predates this feature) from "we do
 * not deliver to that address" (>0 but no zone matched, which must be refused
 * rather than shipped for free).
 */
export async function countActiveZones(storeId: Types.ObjectId): Promise<number> {
  return ShippingZone.countDocuments({ storeId, isActive: true });
}

/**
 * Validates a customer's chosen rate and returns its authoritative price.
 *
 * Three failure modes, all deliberate:
 *   • no rate chosen while the store offers options → caller decides (returns null)
 *   • rate does not belong to this tenant           → 404, never leak existence
 *   • rate is not offered for THIS destination      → 400
 *
 * The last is the one that matters for revenue: without it a shopper could read
 * a domestic rate's ID from the quote endpoint and reuse it on an international
 * address, paying local postage for an overseas parcel.
 */
export async function resolveSelectedRate(
  storeId: Types.ObjectId,
  address: DestinationAddress,
  subtotal: number,
  rateId: string | undefined
): Promise<{ rateId: Types.ObjectId; name: string; amount: number } | null> {
  if (!rateId) return null;

  if (!Types.ObjectId.isValid(rateId)) {
    throw createError('Invalid shipping rate ID', 400, 'BAD_REQUEST');
  }

  const rate = await ShippingRate.findOne({
    _id: new Types.ObjectId(rateId),
    storeId,
    isActive: true,
  }).lean<IShippingRate>();

  if (!rate) throw createError('Shipping method not found', 404, 'NOT_FOUND');

  const zone = await matchZone(storeId, address);
  if (!zone || zone._id.toString() !== rate.zoneId.toString()) {
    throw createError(
      'That shipping method is not available for this delivery address',
      400,
      'BAD_REQUEST'
    );
  }

  return {
    rateId: rate._id,
    name: rate.name,
    // Re-derived server-side. The request never carries an amount.
    amount: calculateShippingAmount(rate, subtotal),
  };
}

// ── Merchant CRUD ─────────────────────────────────────────────────────────────
// All tenant-scoped: the storeId is always part of the filter, never taken from
// the request body.

export async function listZones(storeId: Types.ObjectId) {
  return ShippingZone.find({ storeId }).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

export async function createZone(storeId: Types.ObjectId, data: Partial<IShippingZone>) {
  return ShippingZone.create({ ...data, storeId });
}

export async function updateZone(
  storeId: Types.ObjectId,
  id: string,
  data: Partial<IShippingZone>
) {
  const zone = await ShippingZone.findOneAndUpdate(
    { _id: id, storeId },
    { $set: { ...data, storeId } },
    { new: true, runValidators: true }
  ).lean();
  if (!zone) throw createError('Shipping zone not found', 404, 'NOT_FOUND');
  return zone;
}

export async function deleteZone(storeId: Types.ObjectId, id: string) {
  const zone = await ShippingZone.findOneAndDelete({ _id: id, storeId });
  if (!zone) throw createError('Shipping zone not found', 404, 'NOT_FOUND');
  // Rates are meaningless without their zone and would otherwise be
  // unreachable-but-chargeable: resolveSelectedRate looks a rate up by ID
  // first, so an orphan could still be quoted if its zone id ever collided.
  await ShippingRate.deleteMany({ storeId, zoneId: zone._id });
  return zone;
}

export async function listRates(storeId: Types.ObjectId, zoneId?: string) {
  const filter: Record<string, unknown> = { storeId };
  if (zoneId) {
    if (!Types.ObjectId.isValid(zoneId)) {
      throw createError('Invalid zone ID', 400, 'BAD_REQUEST');
    }
    filter.zoneId = new Types.ObjectId(zoneId);
  }
  return ShippingRate.find(filter).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

export async function createRate(storeId: Types.ObjectId, data: Partial<IShippingRate>) {
  // The zone must belong to the same tenant, or a merchant could attach a rate
  // to another store's zone and have it quoted there.
  const zone = await ShippingZone.findOne({ _id: data.zoneId, storeId }).lean();
  if (!zone) throw createError('Shipping zone not found', 404, 'NOT_FOUND');
  return ShippingRate.create({ ...data, storeId });
}

export async function updateRate(
  storeId: Types.ObjectId,
  id: string,
  data: Partial<IShippingRate>
) {
  if (data.zoneId) {
    const zone = await ShippingZone.findOne({ _id: data.zoneId, storeId }).lean();
    if (!zone) throw createError('Shipping zone not found', 404, 'NOT_FOUND');
  }
  const rate = await ShippingRate.findOneAndUpdate(
    { _id: id, storeId },
    { $set: { ...data, storeId } },
    { new: true, runValidators: true }
  ).lean();
  if (!rate) throw createError('Shipping rate not found', 404, 'NOT_FOUND');
  return rate;
}

export async function deleteRate(storeId: Types.ObjectId, id: string) {
  const rate = await ShippingRate.findOneAndDelete({ _id: id, storeId });
  if (!rate) throw createError('Shipping rate not found', 404, 'NOT_FOUND');
  return rate;
}
