import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Shipping zones and rates.
 *
 * A ZONE is a set of destination countries. A RATE is a purchasable delivery
 * option within a zone. A destination resolves to exactly one zone (most
 * specific wins) and offers every active rate in it.
 *
 * Zone matching uses ISO 3166-1 alpha-2 country codes. The literal `'*'` is a
 * catch-all meaning "rest of world", so a merchant can offer international
 * delivery without enumerating 200 countries. An explicit country always beats
 * the catch-all — see `matchZone` in shipping.service.ts.
 *
 * Deliberately NOT modelled yet: weight-based rates. There is no `weight` field
 * on the product, so a weight band could not be evaluated. `RATE_TYPES` is the
 * extension point when that lands.
 */

export const RATE_TYPES = ['flat', 'free_over', 'price_tier'] as const;
export type ShippingRateType = typeof RATE_TYPES[number];

// ── Zone ──────────────────────────────────────────────────────────────────────

export interface IShippingZone extends Document {
  storeId: Types.ObjectId;
  name: string;
  /** ISO-2 codes, uppercase. `['*']` means rest of world. */
  countries: string[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const shippingZoneSchema = new Schema<IShippingZone>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    countries: {
      type: [String],
      default: [],
      // Stored uppercase so matching never has to case-fold at query time.
      set: (v: string[]) => (v ?? []).map((c) => c.trim().toUpperCase()),
    },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

shippingZoneSchema.index({ storeId: 1, isActive: 1 });

export const ShippingZone = mongoose.model<IShippingZone>('ShippingZone', shippingZoneSchema);

// ── Rate ──────────────────────────────────────────────────────────────────────

export interface IShippingTier {
  minSubtotal: number;
  /** `null` means "and above". */
  maxSubtotal: number | null;
  amount: number;
}

export interface IShippingRate extends Document {
  storeId: Types.ObjectId;
  zoneId: Types.ObjectId;
  name: string;
  description?: string;
  type: ShippingRateType;
  /** Price for `flat`, and the below-threshold price for `free_over`. */
  flatAmount: number;
  /** `free_over` only: at or above this goods subtotal, delivery is free. */
  freeOverThreshold?: number | null;
  /** `price_tier` only. */
  tiers: IShippingTier[];
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const shippingTierSchema = new Schema<IShippingTier>(
  {
    minSubtotal: { type: Number, required: true, min: 0 },
    maxSubtotal: { type: Number, default: null, min: 0 },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const shippingRateSchema = new Schema<IShippingRate>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    zoneId: { type: Schema.Types.ObjectId, ref: 'ShippingZone', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 200 },
    type: { type: String, enum: RATE_TYPES, default: 'flat' },
    flatAmount: { type: Number, default: 0, min: 0 },
    freeOverThreshold: { type: Number, default: null, min: 0 },
    tiers: { type: [shippingTierSchema], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Rate lookup is always "active rates in this zone for this tenant".
shippingRateSchema.index({ storeId: 1, zoneId: 1, isActive: 1 });

export const ShippingRate = mongoose.model<IShippingRate>('ShippingRate', shippingRateSchema);

// ── Pure rate maths ───────────────────────────────────────────────────────────

/**
 * Price of a rate for a given goods subtotal.
 *
 * Pure and exported so the amount is derived identically at quote time and at
 * order time. The client sends only a rate ID — never an amount — so this is
 * the sole source of what delivery costs, and a tampered request cannot
 * discount its own shipping.
 *
 * `subtotal` is the DISCOUNTED goods total, so a coupon can legitimately push
 * an order under a free-shipping threshold.
 */
export function calculateShippingAmount(
  rate: Pick<IShippingRate, 'type' | 'flatAmount' | 'freeOverThreshold' | 'tiers'>,
  subtotal: number
): number {
  const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

  switch (rate.type) {
    case 'free_over': {
      const threshold = rate.freeOverThreshold;
      // A null threshold would otherwise make everything free; treat it as
      // "never free" rather than giving delivery away on a misconfiguration.
      if (threshold === null || threshold === undefined) return round2(rate.flatAmount);
      return subtotal >= threshold ? 0 : round2(rate.flatAmount);
    }

    case 'price_tier': {
      const tier = (rate.tiers ?? []).find(
        (t) => subtotal >= t.minSubtotal && (t.maxSubtotal === null || subtotal <= t.maxSubtotal)
      );
      // No matching band is a configuration gap. Falling back to flatAmount
      // keeps checkout working rather than 500-ing on a half-filled tier table.
      return round2(tier ? tier.amount : rate.flatAmount);
    }

    case 'flat':
    default:
      return round2(rate.flatAmount);
  }
}
