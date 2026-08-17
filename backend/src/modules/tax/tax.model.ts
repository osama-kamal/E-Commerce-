import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Destination-based tax rates.
 *
 * A rate matches an address by country, optionally narrowed to a state or
 * province. `'*'` in `country` is a catch-all.
 *
 * ── Compounding is intentional ────────────────────────────────────────────────
 * EVERY active rate whose scope matches the destination applies, and their
 * amounts are summed. This is what Canada (GST + PST) and many US
 * state-plus-county regimes actually require, and it matches WooCommerce's
 * "standard rates" behaviour.
 *
 * The consequence a merchant must understand: a country-wide rate and a
 * state-level rate for the same address BOTH apply. To model "state overrides
 * country", scope the country-level rate to the states it should cover rather
 * than leaving it open. `matchTaxRates` documents the selection.
 *
 * Whether a rate is added to the price or extracted from it is NOT stored here
 * — that is `store.pricesIncludeTax`, because it is a property of how the
 * merchant lists prices, not of the jurisdiction.
 */

export interface ITaxRate extends Document {
  storeId: Types.ObjectId;
  /** Shown on the invoice, e.g. "VAT", "GST", "NY Sales Tax". */
  name: string;
  /** Percentage: 20 means 20%. */
  rate: number;
  /** ISO-2 country code, uppercase. `'*'` matches any country. */
  country: string;
  /** Optional narrowing. Empty/absent means the whole country. */
  state?: string | null;
  /** Jurisdiction-dependent: most EU VAT taxes delivery, many US states do not. */
  appliesToShipping: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const taxRateSchema = new Schema<ITaxRate>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    rate: {
      type: Number,
      required: true,
      min: [0, 'Tax rate cannot be negative'],
      // A rate above 100% is always a data-entry error (e.g. 2000 for 20.00)
      // and would produce a total larger than the goods. Rejected at the schema
      // so it can never reach the money engine.
      max: [100, 'Tax rate cannot exceed 100%'],
    },
    country: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 2,
      // `'*'` is 1 char so it passes maxlength; the enum-like check lives in the
      // Zod schema where a clear 400 can be returned.
    },
    state: { type: String, trim: true, uppercase: true, default: null, maxlength: 64 },
    appliesToShipping: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Every lookup is "active rates for this tenant matching a country".
taxRateSchema.index({ storeId: 1, isActive: 1, country: 1 });

export const TaxRate = mongoose.model<ITaxRate>('TaxRate', taxRateSchema);
