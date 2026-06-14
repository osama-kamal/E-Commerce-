import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { Store } from '../modules/stores/store.model';
import { createError } from './errorHandler';

/**
 * Resolves the current tenant store from the request.
 *
 * Resolution order:
 *  1. `X-Store-ID` header  (ObjectId of the store — preferred for API clients)
 *  2. `X-Store-Slug` header (slug string)
 *  3. Subdomain of the Host header  (e.g. "myshop.example.com" → slug "myshop")
 *  4. Custom domain match
 *
 * On success, attaches `req.store` and (if the user is already authenticated)
 * also sets `req.user.storeId`.
 *
 * Call this middleware AFTER `express.json()` but BEFORE route handlers that
 * need tenant isolation.
 */
export async function resolveStore(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    let store = null;

    // 1. X-Store-ID header
    const storeIdHeader = req.headers['x-store-id'] as string | undefined;
    if (storeIdHeader && Types.ObjectId.isValid(storeIdHeader)) {
      store = await Store.findOne({ _id: storeIdHeader, isActive: true }).lean();
    }

    // 2. X-Store-Slug header
    if (!store) {
      const slugHeader = req.headers['x-store-slug'] as string | undefined;
      if (slugHeader) {
        store = await Store.findOne({ slug: slugHeader.toLowerCase(), isActive: true }).lean();
      }
    }

    // 3. Subdomain from Host header
    if (!store) {
      const host = req.headers.host ?? '';
      const parts = host.split('.');
      // Only treat as subdomain if there are at least 3 parts (sub.domain.tld)
      if (parts.length >= 3) {
        const subdomain = parts[0].toLowerCase();
        // Ignore common non-tenant subdomains
        if (!['www', 'api', 'admin', 'app'].includes(subdomain)) {
          store = await Store.findOne({ slug: subdomain, isActive: true }).lean();
        }
      }
    }

    // 4. Custom domain
    if (!store) {
      const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
      if (host) {
        store = await Store.findOne({ customDomain: host, isActive: true }).lean();
      }
    }

    if (!store) {
      return next(createError('Store not found or inactive', 404, 'STORE_NOT_FOUND'));
    }

    req.store = store as any;

    // Propagate storeId to req.user if already authenticated
    if (req.user) {
      req.user.storeId = (store as any)._id as Types.ObjectId;
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Variant that does NOT fail when no store is found.
 * Use on routes that can work with or without a store context
 * (e.g. the store-creation endpoint itself).
 */
export async function resolveStoreOptional(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const storeIdHeader = req.headers['x-store-id'] as string | undefined;
    if (storeIdHeader && Types.ObjectId.isValid(storeIdHeader)) {
      const store = await Store.findOne({ _id: storeIdHeader, isActive: true }).lean();
      if (store) {
        req.store = store as any;
        if (req.user) req.user.storeId = (store as any)._id as Types.ObjectId;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Guard middleware — ensures the authenticated user is the owner of the
 * resolved store (or is a super-admin).
 * Must be used AFTER both `authenticateJWT` and `resolveStore`.
 */
export function requireStoreOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.store || !req.user) {
    return next(createError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  const isOwner = req.store.ownerId.toString() === req.user.userId.toString();
  const isSuperAdmin = req.user.role === 'super-admin';

  if (!isOwner && !isSuperAdmin) {
    return next(createError('You do not have permission to manage this store', 403, 'FORBIDDEN'));
  }

  next();
}
