import { Request, Response, NextFunction } from 'express';
import * as cartService from './cart.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';

/**
 * For cart operations, always use the user's own storeId from the JWT.
 * This prevents the cart from being created/read in the wrong store
 * when the X-Store-ID header doesn't match the user's store.
 */
function getCartStoreId(req: Request): string {
  // Prefer the user's storeId from JWT (authoritative — set at login)
  const userStoreId = req.user?.storeId?.toString();
  if (userStoreId) return userStoreId;

  // Fallback to resolved store from header (for edge cases)
  const storeId = req.store?._id?.toString();
  if (!storeId) throw createError('Store context is required', 400, 'BAD_REQUEST');
  return storeId;
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
