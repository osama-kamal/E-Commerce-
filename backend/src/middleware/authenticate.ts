import { Request, Response, NextFunction } from 'express';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { verifyAccessToken } from '../utils/jwt';
import { createError } from './errorHandler';

/**
 * Verifies the Bearer token in the Authorization header.
 * Attaches { userId, role, storeId } to req.user on success.
 *
 * The storeId embedded in the JWT is used as a secondary cross-check against
 * the store resolved by resolveStore middleware — preventing tokens issued for
 * one store from being used against another.
 */
export function authenticateJWT(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(createError('Authentication token is required', 401, 'UNAUTHORIZED'));
  }

  const token = authHeader.slice(7);

  // Use async IIFE so we can await the ownership check without changing the middleware signature
  (async () => {
    try {
      const payload = verifyAccessToken(token);

      req.user = {
        userId: new Types.ObjectId(payload.userId),
        role: payload.role,
        storeId: new Types.ObjectId(payload.storeId),
      };

      // Cross-tenant guard: if a store has already been resolved (by resolveStore),
      // ensure the token's storeId matches it OR the user is the store owner OR
      // the user is a super-admin (who can access any store).
      if (req.store) {
        const resolvedStoreId = (req.store as any)._id.toString();
        const tokenStoreId = payload.storeId.toString();

        if (tokenStoreId !== resolvedStoreId) {
          // Super-admin: always allow cross-store access
          const isSuperAdmin = payload.role === 'super-admin';

          if (!isSuperAdmin) {
            // Check if this user owns the resolved store (multi-store vendor switching)
            const { Store } = await import('../modules/stores/store.model');
            const isOwner = await Store.exists({
              _id: resolvedStoreId,
              ownerId: new Types.ObjectId(payload.userId),
            });

            if (!isOwner) {
              return next(createError('Token does not belong to this store', 403, 'FORBIDDEN'));
            }
          }

          // Owner or super-admin switching stores — update storeId to the resolved store
          req.user!.storeId = new Types.ObjectId(resolvedStoreId);
        }
      }

      next();
    } catch (err) {
      if (err instanceof TokenExpiredError) {
        return next(createError('Token has expired', 401, 'UNAUTHORIZED'));
      }
      if (err instanceof JsonWebTokenError) {
        return next(createError('Invalid token', 401, 'UNAUTHORIZED'));
      }
      next(err);
    }
  })();
}

/**
 * Platform-level guard — admits ONLY role 'super-admin'.
 * Must be used after authenticateJWT.
 *
 * Use this (never `authorizeRole('admin', 'super-admin')`) on any endpoint that
 * acts across tenants: listing every store, mutating an arbitrary store's plan,
 * or reading platform-wide billing data.
 *
 * Rationale: public onboarding mints store owners with role 'admin'. Treating
 * 'admin' as a platform role therefore let anyone self-register and take over
 * the platform. 'admin' means "administrator OF ONE STORE", nothing more.
 */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    return next(createError('Authentication token is required', 401, 'UNAUTHORIZED'));
  }
  if (req.user.role !== 'super-admin') {
    return next(
      createError('This action requires platform administrator privileges', 403, 'FORBIDDEN')
    );
  }
  next();
}

/**
 * Role-based access control middleware.
 * Must be used after authenticateJWT.
 *
 * super-admin automatically passes ALL role checks — they have every permission
 * that admin has, plus platform-level access.
 *
 * ⚠️  This is a TENANT-level check. `authorizeRole('admin')` means "an admin of
 * the store resolved for this request", not "a platform operator". For
 * cross-tenant endpoints use `requireSuperAdmin` above.
 */
export function authorizeRole(...roles: Array<'super-admin' | 'admin' | 'customer'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createError('You do not have permission to access this resource', 403, 'FORBIDDEN'));
    }
    // super-admin bypasses all role restrictions
    if (req.user.role === 'super-admin') return next();
    if (!roles.includes(req.user.role as any)) {
      return next(
        createError('You do not have permission to access this resource', 403, 'FORBIDDEN')
      );
    }
    next();
  };
}
