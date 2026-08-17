import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import * as shippingService from './shipping.service';
import * as cartRepo from '../cart/cart.repository';
import * as productRepo from '../products/product.repository';
import { couponService } from '../coupons/coupon.service';
import { calculateOrderTotals } from '../checkout/money';
import { matchTaxRates } from '../tax/tax.service';
import { Store } from '../stores/store.model';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

function getStoreId(req: Request): Types.ObjectId {
  const storeId = req.store?._id;
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId as Types.ObjectId;
}

/**
 * Prices the signed-in customer's cart, server-side.
 *
 * Computed from the stored cart rather than accepted from the request: the
 * subtotal decides which delivery options are offered and whether a
 * free-shipping threshold is met, so trusting a client-supplied figure would
 * let a shopper claim free delivery on a £5 basket.
 *
 * Returns the raw lines as well as the totals so the caller can feed the money
 * engine directly instead of re-deriving them.
 */
async function resolveCartPricing(
  storeId: Types.ObjectId,
  customerId: Types.ObjectId,
  couponCode?: string
): Promise<{
  grossSubtotal: number;
  discountedSubtotal: number;
  discountAmount: number;
  lines: Array<{ unitPrice: number; quantity: number }>;
}> {
  const empty = { grossSubtotal: 0, discountedSubtotal: 0, discountAmount: 0, lines: [] };

  const cart = await cartRepo.findCart(storeId, customerId);
  if (!cart || cart.items.length === 0) return empty;

  const products = await productRepo.findProductsByIds(
    cart.items.map((i) => i.productId),
    storeId
  );
  const priceMap = new Map(products.map((p) => [p._id.toString(), p]));

  const lines: Array<{ unitPrice: number; quantity: number }> = [];
  let grossSubtotal = 0;

  for (const item of cart.items) {
    const product = priceMap.get(item.productId.toString());
    if (!product) continue;
    const effective =
      product.discount > 0
        ? Math.round(product.price * (1 - product.discount / 100) * 100) / 100
        : product.price;
    lines.push({ unitPrice: effective, quantity: item.quantity });
    grossSubtotal += effective * item.quantity;
  }
  grossSubtotal = Math.round(grossSubtotal * 100) / 100;

  // Read-only coupon preview — deliberately NOT validateAndApplyCoupon, which
  // increments usedCount. Quoting delivery must never burn a redemption, and a
  // shopper who re-quotes five times while comparing options must not exhaust
  // a limited promotion.
  let discountAmount = 0;
  if (couponCode) {
    try {
      const preview = await couponService.validateCoupon(
        storeId.toString(),
        couponCode,
        grossSubtotal
      );
      discountAmount = Math.min(Math.max(0, preview.discount), grossSubtotal);
    } catch {
      // An invalid coupon simply does not discount the quote. Checkout surfaces
      // the real error when the order is placed.
    }
  }

  const discountedSubtotal = Math.max(
    0,
    Math.round((grossSubtotal - discountAmount) * 100) / 100
  );

  return { grossSubtotal, discountedSubtotal, discountAmount, lines };
}

// ── Storefront: quote ─────────────────────────────────────────────────────────

export async function quoteShipping(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const storeId = getStoreId(req);
    const customerId = req.user!.userId;
    const { country, state, shippingRateId } = req.body as {
      country: string;
      state?: string;
      shippingRateId?: string;
    };
    const couponCode = (req.query.couponCode as string | undefined) ?? undefined;

    const { grossSubtotal, discountedSubtotal, discountAmount, lines } =
      await resolveCartPricing(storeId, customerId, couponCode);

    const options = await shippingService.getShippingOptions(
      storeId,
      { country, state },
      discountedSubtotal
    );

    // Preview against the shopper's current selection so the totals they see
    // match what they will be charged. A stale ID (they changed country after
    // selecting) falls back to the first option rather than erroring — the
    // authoritative validation happens at order time, where a mismatch is a
    // real 400.
    const selected = options.find((o) => o.rateId === shippingRateId) ?? options[0];

    const store = await Store.findById(storeId).select('pricesIncludeTax').lean();
    const taxRates = await matchTaxRates(storeId, { country, state });

    // Same engine as placeOrder, so the quoted total and the charged total
    // cannot drift. Duplicating this arithmetic on the client is exactly how
    // checkout totals end up disagreeing with invoices.
    const totals = calculateOrderTotals({
      items: lines,
      discountAmount,
      shippingAmount: selected?.amount ?? 0,
      taxRates,
      pricesIncludeTax: store?.pricesIncludeTax ?? false,
    });

    sendSuccess(res, {
      subtotal: grossSubtotal,
      options,
      selectedRateId: selected?.rateId ?? null,
      totals,
      // An empty list is a legitimate answer meaning "we do not deliver there",
      // not an error. The client renders it as such rather than as a failure.
      shipsToDestination: options.length > 0,
    });
  } catch (err) { next(err); }
}

// ── Merchant: zones ───────────────────────────────────────────────────────────

export async function listZones(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await shippingService.listZones(getStoreId(req)));
  } catch (err) { next(err); }
}

export async function createZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await shippingService.createZone(getStoreId(req), req.body), 201);
  } catch (err) { next(err); }
}

export async function updateZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await shippingService.updateZone(getStoreId(req), req.params.id, req.body));
  } catch (err) { next(err); }
}

export async function deleteZone(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await shippingService.deleteZone(getStoreId(req), req.params.id);
    sendSuccess(res, { deleted: true });
  } catch (err) { next(err); }
}

// ── Merchant: rates ───────────────────────────────────────────────────────────

export async function listRates(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const zoneId = req.query.zoneId as string | undefined;
    sendSuccess(res, await shippingService.listRates(getStoreId(req), zoneId));
  } catch (err) { next(err); }
}

export async function createRate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await shippingService.createRate(getStoreId(req), req.body), 201);
  } catch (err) { next(err); }
}

export async function updateRate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, await shippingService.updateRate(getStoreId(req), req.params.id, req.body));
  } catch (err) { next(err); }
}

export async function deleteRate(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await shippingService.deleteRate(getStoreId(req), req.params.id);
    sendSuccess(res, { deleted: true });
  } catch (err) { next(err); }
}
