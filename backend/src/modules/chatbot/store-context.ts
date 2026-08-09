import { Types } from 'mongoose';
import { Store } from '../stores/store.model';
import { Product } from '../products/product.model';
import { Category } from '../categories/category.model';
import { ShippingZone, ShippingRate } from '../shipping/shipping.model';
import { TaxRate } from '../tax/tax.model';
import { cacheService } from '../../services/cache.service';
import { createError } from '../../middleware/errorHandler';
import { formatMoney } from '../checkout/currency';

/**
 * The facts the assistant is allowed to state about a store.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 * The system prompt asserted four things as universal truth:
 *
 *     - Free shipping on orders over $50
 *     - 30-day return policy
 *     - Secure payments via Stripe
 *     - N products across N categories
 *
 * None of it was tenant-aware. This is a multi-tenant platform where every
 * merchant sets their own shipping zones, rates and free-delivery thresholds,
 * their own tax rates, and their own currency, and may settle through Paymob
 * rather than Stripe. So the assistant confidently told every merchant's
 * customers the same four claims, most of which were wrong for most stores —
 * and the shipping claim became MORE wrong the day per-store shipping shipped,
 * because there is now real data it was contradicting.
 *
 * The category count was wrong for everyone: it read
 * `Product.distinct('category')`, and the field is `categoryId`. That returns an
 * empty array for every store, so the prompt always said "across 0 categories".
 *
 * ── The rule this encodes ─────────────────────────────────────────────────────
 * The assistant may state what the merchant has actually configured, and must
 * refer the customer to the merchant for anything else. Returns are the case
 * that matters: no return-policy field exists anywhere in the schema, so there
 * is nothing to ground on and the honest answer is the merchant's contact
 * details — not a 30-day window invented by a language model.
 */
export interface StoreChatContext {
  storeName: string;
  /** ISO 4217 — every price the assistant quotes is rendered in this. */
  currency: string;
  pricesIncludeTax: boolean;
  contactEmail?: string;
  contactPhone?: string;
  productCount: number;
  categoryNames: string[];
  shipping: {
    /** False when the merchant has configured no zones — then say nothing about delivery. */
    configured: boolean;
    countries: string[];
    cheapestRateLabel?: string;
    freeOverLabel?: string;
  };
  /** Names of the tax rates in force, e.g. ["VAT"]. Empty when none configured. */
  taxNames: string[];
}

/**
 * Tenant is part of the key by construction, not appended by the caller.
 *
 * The existing CACHE_KEYS helpers take no storeId and every call site appends
 * one by hand. That works today but is the same forgettable pattern that left
 * the recommendations module unscoped, so this key builds it in.
 */
const contextCacheKey = (storeId: string) => `chatbot:store-context:${storeId}`;

/** Short. Merchants edit shipping and tax and expect the assistant to catch up. */
const CONTEXT_TTL_SECONDS = 300;

/**
 * Loads the facts for one store.
 *
 * `storeId` is required, and invalid input throws rather than falling back to a
 * store-less query. An unscoped chatbot would answer using another merchant's
 * catalogue.
 */
export async function buildStoreContext(storeId: string): Promise<StoreChatContext> {
  if (!storeId || !Types.ObjectId.isValid(storeId)) {
    throw createError('Store context is required', 400, 'BAD_REQUEST');
  }

  const cached = cacheService.get<StoreChatContext>(contextCacheKey(storeId));
  if (cached) return cached;

  const storeObjId = new Types.ObjectId(storeId);

  const store = await Store.findById(storeObjId)
    .select('name currency pricesIncludeTax settings')
    .lean();

  if (!store) {
    throw createError('Store not found', 404, 'NOT_FOUND');
  }

  const currency = (store.currency ?? 'USD').toUpperCase();

  const [productCount, categoryIds, zones, rates, taxRates] = await Promise.all([
    Product.countDocuments({ storeId: storeObjId, isDeleted: false }),
    // `distinct('categoryId')`, not `distinct('category')` — the latter is not a
    // field on this schema and always returned [].
    Product.distinct('categoryId', { storeId: storeObjId, isDeleted: false }),
    ShippingZone.find({ storeId: storeObjId, isActive: true }).select('countries').lean(),
    ShippingRate.find({ storeId: storeObjId, isActive: true })
      .select('name flatAmount freeOverThreshold type')
      .lean(),
    TaxRate.find({ storeId: storeObjId, isActive: true }).select('name').lean(),
  ]);

  const categories = await Category.find({
    storeId: storeObjId,
    _id: { $in: categoryIds },
  })
    .select('name')
    .lean();

  // Cheapest flat rate is the one worth quoting; tiered rates depend on basket
  // value and cannot be stated as a single figure without misleading somebody.
  const flatRates = rates.filter((r) => r.type === 'flat' && typeof r.flatAmount === 'number');
  const cheapest = flatRates.sort((a, b) => (a.flatAmount ?? 0) - (b.flatAmount ?? 0))[0];

  const freeOver = rates
    .map((r) => r.freeOverThreshold)
    .filter((t): t is number => typeof t === 'number' && t > 0)
    .sort((a, b) => a - b)[0];

  const context: StoreChatContext = {
    storeName: store.name,
    currency,
    pricesIncludeTax: store.pricesIncludeTax ?? false,
    contactEmail: store.settings?.contactEmail || undefined,
    contactPhone: store.settings?.contactPhone || undefined,
    productCount,
    categoryNames: categories.map((c) => c.name),
    shipping: {
      configured: zones.length > 0,
      countries: [...new Set(zones.flatMap((z) => z.countries ?? []))],
      cheapestRateLabel: cheapest
        ? `${cheapest.name} — ${formatMoney(cheapest.flatAmount ?? 0, currency)}`
        : undefined,
      freeOverLabel: freeOver !== undefined ? formatMoney(freeOver, currency) : undefined,
    },
    taxNames: taxRates.map((t) => t.name),
  };

  cacheService.set(contextCacheKey(storeId), context, CONTEXT_TTL_SECONDS);
  return context;
}

/** Drops a store's cached context — call after a merchant edits shipping or tax. */
export function invalidateStoreContext(storeId: string): void {
  cacheService.delete(contextCacheKey(storeId));
}

/**
 * Renders the context as the system prompt's factual section.
 *
 * Every line is omitted rather than guessed when the underlying data is absent.
 * A merchant with no shipping zones gets no delivery claim at all, which is
 * correct: the checkout will not charge for delivery either.
 */
export function renderStoreFacts(ctx: StoreChatContext): string {
  const lines: string[] = [
    `- Store name: ${ctx.storeName}`,
    `- Prices are quoted in ${ctx.currency}`,
    `- Catalogue: ${ctx.productCount} product${ctx.productCount === 1 ? '' : 's'}`,
  ];

  if (ctx.categoryNames.length > 0) {
    lines.push(`- Categories: ${ctx.categoryNames.slice(0, 20).join(', ')}`);
  }

  if (ctx.shipping.configured) {
    if (ctx.shipping.countries.length > 0) {
      lines.push(`- Delivers to: ${ctx.shipping.countries.slice(0, 30).join(', ')}`);
    }
    if (ctx.shipping.cheapestRateLabel) {
      lines.push(`- Delivery from: ${ctx.shipping.cheapestRateLabel}`);
    }
    if (ctx.shipping.freeOverLabel) {
      lines.push(`- Free delivery on orders over ${ctx.shipping.freeOverLabel}`);
    }
  } else {
    lines.push('- Delivery: not configured for this store — do NOT quote shipping costs');
  }

  if (ctx.taxNames.length > 0) {
    lines.push(
      `- Tax: ${ctx.taxNames.join(', ')}${ctx.pricesIncludeTax ? ' (included in listed prices)' : ' (added at checkout)'}`
    );
  }

  if (ctx.contactEmail) lines.push(`- Contact email: ${ctx.contactEmail}`);
  if (ctx.contactPhone) lines.push(`- Contact phone: ${ctx.contactPhone}`);

  return lines.join('\n');
}
