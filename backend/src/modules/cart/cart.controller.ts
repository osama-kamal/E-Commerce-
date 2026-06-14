import { Request, Response, NextFunction } from 'express';
import * as cartService from './cart.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

/**
 * Resolve the store context for cart operations.
 *
 * Priority:
 *  1. req.store._id — set by resolveStore middleware from X-Store-ID or X-Store-Slug header.
 *     This is the authoritative store the customer is currently browsing. When a customer
 *     visits /s/default the slug resolves to the correct storeId here, regardless of what
 *     store the customer's JWT was originally issued for.
 *  2. req.user.storeId — the store baked into the JWT. Used only as a fallback when no
 *     explicit store header is present (e.g. vendor using the admin panel).
 */
function getCartStoreId(req: Request): string {
  // Prefer the store resolved from the request header (X-Store-ID or X-Store-Slug)
  const resolvedStoreId = req.store?._id?.toString();
  if (resolvedStoreId) return resolvedStoreId;

  // Fallback to the user's own storeId from JWT (vendor admin flows)
  const userStoreId = req.user?.storeId?.toString();
  if (userStoreId) return userStoreId;

  throw createError('Store context is required', 400, 'BAD_REQUEST');
}

export async function getCart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cart = await cartService.getCart(getCartStoreId(req), req.user!.userId.toString());
    sendSuccess(res, cart);
  } catch (err) { next(err); }
}

export async function addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productId, quantity, selectedSize } = req.body as { productId: string; quantity: number; selectedSize?: string };
    const cart = await cartService.addItem(getCartStoreId(req), req.user!.userId.toString(), productId, quantity, selectedSize);
    sendSuccess(res, cart, 201);
  } catch (err) { next(err); }
}

export async function updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productId } = req.params as { productId: string };
    const { quantity, selectedSize } = req.body as { quantity: number; selectedSize?: string };
    const cart = await cartService.updateItemQuantity(getCartStoreId(req), req.user!.userId.toString(), productId, quantity, selectedSize);
    sendSuccess(res, cart);
  } catch (err) { next(err); }
}

export async function removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { productId } = req.params as { productId: string };
    const cart = await cartService.removeItem(getCartStoreId(req), req.user!.userId.toString(), productId);
    sendSuccess(res, cart);
  } catch (err) { next(err); }
}

export async function clearCart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cart = await cartService.clearCart(getCartStoreId(req), req.user!.userId.toString());
    sendSuccess(res, cart);
  } catch (err) { next(err); }
}
