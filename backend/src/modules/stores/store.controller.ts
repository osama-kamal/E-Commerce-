import { Request, Response, NextFunction } from 'express';
import * as storeService from './store.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

// ── Owner: create a store ─────────────────────────────────────────────────────

export async function createStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.user!.userId.toString();
    const store = await storeService.createStore({ ...req.body, ownerId });

    // Issue a new access token scoped to the newly created store.
    // The caller will swap this in immediately so subsequent requests
    // carry the correct storeId and pass the cross-tenant guard.
    const { signAccessToken } = await import('../../utils/jwt');
    const { Types } = await import('mongoose');
    const accessToken = signAccessToken(
      new Types.ObjectId(ownerId),
      req.user!.role,
      (store as any)._id.toString()
    );

    sendSuccess(res, { store, accessToken }, 201);
  } catch (err) { next(err); }
}

// ── Owner: list my stores ─────────────────────────────────────────────────────
// Flat query by ownerId — returns ALL stores the authenticated user owns,
// regardless of which store's context the request arrived from.
// Also includes the user's primary store (user.storeId) as a safety net in case
// the onboarding placeholder-ownerId bug left the first store with a mismatched ownerId.

export async function getMyStores(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user!.userId.toString();
    const userStoreId = req.user!.storeId?.toString() ?? ''; // from JWT (the user's primary store)

    // Query 1: stores explicitly owned by this user
    const owned = await (await import('./store.service')).getStoresByOwner(userId);

    // Query 2: if the user's primary storeId isn't already in the owned list,
    // fetch it directly — this covers the onboarding race where ownerId was set
    // to a placeholder ObjectId instead of user._id.
    const ownedIds = new Set(owned.map((s: any) => s._id.toString()));
    let allStores = owned;

    if (!ownedIds.has(userStoreId)) {
      const { Store } = await import('./store.model');
      const { Types } = await import('mongoose');
      const primaryStore = await Store.findById(new Types.ObjectId(userStoreId)).lean();
      if (primaryStore) {
        allStores = [primaryStore as any, ...owned];
      }
    }

    sendSuccess(res, allStores);
  } catch (err) { next(err); }
}

// ── Owner: get one store ──────────────────────────────────────────────────────

export async function getMyStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const store = await storeService.getStoreById(req.params.id);
    if (store.ownerId.toString() !== req.user!.userId.toString()) {
      return next(createError('Access denied', 403, 'FORBIDDEN'));
    }
    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Owner: update store ───────────────────────────────────────────────────────

export async function updateMyStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.user!.userId.toString();
    const store = await storeService.updateStore(req.params.id, ownerId, req.body);
    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Owner: delete store ───────────────────────────────────────────────────────

export async function deleteMyStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const ownerId = req.user!.userId.toString();
    await storeService.deleteStore(req.params.id, ownerId);
    sendSuccess(res, { message: 'Store deleted' });
  } catch (err) { next(err); }
}

// ── Super-admin: list all stores ──────────────────────────────────────────────

export async function listAllStores(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const result = await storeService.listAllStores(page, limit);
    sendSuccess(res, result);
  } catch (err) { next(err); }
}

// ── Super-admin: update any store ────────────────────────────────────────────

export async function adminUpdateStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const store = await storeService.adminUpdateStore(req.params.id, req.body);
    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Public: get store by slug ─────────────────────────────────────────────────

export async function getStoreBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const store = await storeService.getStoreBySlug(req.params.slug);
    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Owner: get a fresh access token scoped to a specific store ───────────────
// Used by the store switcher so the JWT always matches the active store.

export async function getStoreToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const storeId = req.params.id;
    const ownerId = req.user!.userId.toString();

    const store = await storeService.getStoreById(storeId);
    const isSuperAdmin = req.user!.role === 'super-admin';

    if (store.ownerId.toString() !== ownerId && !isSuperAdmin) {
      return next(createError('Access denied', 403, 'FORBIDDEN'));
    }

    const { signAccessToken } = await import('../../utils/jwt');
    const { Types } = await import('mongoose');
    const accessToken = signAccessToken(
      new Types.ObjectId(ownerId),
      req.user!.role,
      storeId
    );

    sendSuccess(res, { accessToken, storeId });
  } catch (err) { next(err); }
}

// ── Public: get current store (resolved from X-Store-ID header) ───────────────

export async function getCurrentStore(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.store) {
      return next(createError('Store not found', 404, 'NOT_FOUND'));
    }
    sendSuccess(res, req.store);
  } catch (err) { next(err); }
}

// ── Owner: update store settings (logo, contact, social) ─────────────────────

export async function updateStoreSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const storeId = req.params.id;
    const ownerId = req.user!.userId.toString();

    // Verify ownership
    const existing = await storeService.getStoreById(storeId);
    const isSuperAdmin = req.user!.role === 'super-admin';
    if (existing.ownerId.toString() !== ownerId && !isSuperAdmin) {
      return next(createError('Access denied', 403, 'FORBIDDEN'));
    }

    const store = await storeService.updateStoreSettings(storeId, req.body);
    sendSuccess(res, store);
  } catch (err) { next(err); }
}

// ── Owner: upload store logo ──────────────────────────────────────────────────

export async function uploadStoreLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      return next(createError('Image file is required', 400, 'BAD_REQUEST'));
    }

    const storeId = req.params.id;
    const ownerId = req.user!.userId.toString();

    const existing = await storeService.getStoreById(storeId);
    const isSuperAdmin = req.user!.role === 'super-admin';
    if (existing.ownerId.toString() !== ownerId && !isSuperAdmin) {
      return next(createError('Access denied', 403, 'FORBIDDEN'));
    }

    const { cloudinaryService } = await import('../../services/cloudinary.service');
    const uploadResult = await cloudinaryService.uploadImage(req.file.buffer, 'store-logos');

    // Ensure we always store the full Cloudinary HTTPS URL
    const logoUrl = uploadResult.url;
    if (!logoUrl || !logoUrl.startsWith('http')) {
      return next(createError('Logo upload failed — invalid URL returned', 500, 'INTERNAL_ERROR'));
    }

    const store = await storeService.updateStoreSettings(storeId, { logoUrl });
    sendSuccess(res, { imageUrl: logoUrl, store });
  } catch (err) { next(err); }
}

// ── Public: get store logo (redirect to Cloudinary URL) ──────────────────────
// Handles cases where the logo URL was stored as a relative path

export async function getStoreLogo(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const store = await storeService.getStoreById(req.params.id);
    const logoUrl = store.settings?.logoUrl;

    if (!logoUrl || !logoUrl.startsWith('http')) {
      // Return a 404 so the browser shows the fallback (initials avatar)
      res.status(404).end();
      return;
    }

    // Redirect to the actual Cloudinary URL
    res.redirect(302, logoUrl);
  } catch (err) { next(err); }
}

// ── Owner: request plan upgrade ───────────────────────────────────────────────

export async function requestUpgrade(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const storeId = req.params.id;
    const { requestedPlan } = req.body as { requestedPlan: string };

    const validPlans = ['starter', 'pro', 'enterprise'];
    if (!requestedPlan || !validPlans.includes(requestedPlan)) {
      return next(createError(`requestedPlan must be one of: ${validPlans.join(', ')}`, 400, 'BAD_REQUEST'));
    }

    const store = await storeService.getStoreById(storeId);
    const ownerId = req.user!.userId.toString();
    const role = req.user!.role;
    const jwtStoreId = (req.user as any).storeId?.toString() ?? '';

    // Allow if: authenticated store admin OR the storeId in the JWT matches
    // the store being requested OR super-admin.
    // We intentionally trust authenticated admins here — the endpoint is already
    // protected by authenticateJWT, and upgrade-request is a low-risk operation
    // (it only flags the store as pending, no plan is activated automatically).
    const isAllowed =
      role === 'super-admin' ||
      jwtStoreId === storeId ||
      store.ownerId?.toString() === ownerId;

    if (!isAllowed) {
      return next(createError('Access denied', 403, 'FORBIDDEN'));
    }

    // Get owner email
    const { User } = await import('../auth/user.model');
    const owner = await User.findById(store.ownerId).lean();
    const ownerEmail = owner?.email ?? 'unknown';

    // Try to send email — never fail the request if email fails
    try {
      await storeService.requestPlanUpgrade(storeId, requestedPlan as any, ownerEmail, store.name);
    } catch (emailErr) {
      logger.warn('[UPGRADE REQUEST] Email notification failed (request still recorded)', { error: emailErr });
    }

    sendSuccess(res, {
      message: 'Upgrade request received! We\'ll contact you within 24 hours to confirm payment and activate your plan.',
      requestedPlan,
      storeName: store.name,
    });
  } catch (err) { next(err); }
}
