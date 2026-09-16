import { Types } from 'mongoose';
import { TaxRate, ITaxRate } from './tax.model';
import { TaxRateInput } from '../checkout/money';
import { createError } from '../../middleware/errorHandler';

/**
 * Destination-based tax rate resolution.
 *
 * Selection rule — every ACTIVE rate whose scope matches the address applies,
 * and the money engine sums them. See the header of tax.model.ts for why
 * compounding (rather than most-specific-wins) is the correct default: Canada
 * charges GST plus PST on the same sale, and several US states stack county and
 * city rates on top of the state rate.
 *
 * Scope matching:
 *   country  — exact ISO-2 match, or the '*' catch-all
 *   state    — when a rate names a state, the address must match it; a rate
 *              with no state covers the whole country
 */

export interface TaxableAddress {
  country: string;
  state?: string;
}

function norm(value: string | undefined | null): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Rates applying to a destination, shaped for the money engine.
 *
 * Returns `[]` when the merchant has configured no matching rate — which is the
 * correct outcome, not an error. A store that has not set up tax simply charges
 * none, exactly as it did before tax existed.
 */
export async function matchTaxRates(
  storeId: Types.ObjectId,
  address: TaxableAddress
): Promise<TaxRateInput[]> {
  const country = norm(address.country);
  if (!country) return [];

  const state = norm(address.state);

  const candidates = await TaxRate.find({
    storeId,
    isActive: true,
    // Narrowed in the query so a store with many rates does not load them all.
    country: { $in: [country, '*'] },
  }).lean<ITaxRate[]>();

  return candidates
    .filter((rate) => {
      const scopedState = norm(rate.state);
      // A rate with no state covers the whole country. One that names a state
      // only applies to that state.
      return scopedState === '' || scopedState === state;
    })
    .map((rate) => ({
      name: rate.name,
      rate: rate.rate,
      appliesToShipping: rate.appliesToShipping,
    }));
}

// ── Merchant CRUD ─────────────────────────────────────────────────────────────

export async function listTaxRates(storeId: Types.ObjectId) {
  return TaxRate.find({ storeId }).sort({ country: 1, state: 1, name: 1 }).lean();
}

export async function createTaxRate(storeId: Types.ObjectId, data: Partial<ITaxRate>) {
  return TaxRate.create({ ...data, storeId });
}

export async function updateTaxRate(
  storeId: Types.ObjectId,
  id: string,
  data: Partial<ITaxRate>
) {
  const rate = await TaxRate.findOneAndUpdate(
    { _id: id, storeId },
    { $set: { ...data, storeId } },
    { new: true, runValidators: true }
  ).lean();
  if (!rate) throw createError('Tax rate not found', 404, 'NOT_FOUND');
  return rate;
}

export async function deleteTaxRate(storeId: Types.ObjectId, id: string) {
  const rate = await TaxRate.findOneAndDelete({ _id: id, storeId });
  if (!rate) throw createError('Tax rate not found', 404, 'NOT_FOUND');
  return rate;
}
