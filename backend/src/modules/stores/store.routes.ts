import { Router } from 'express';
import { authenticateJWT, requireSuperAdmin } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createStoreSchema, updateStoreSchema, updateMyStoreSchema, storeIdSchema } from './store.schemas';
import {
  createStore,
  getMyStores,
  getMyStore,
  updateMyStore,
  deleteMyStore,
  listAllStores,
  adminUpdateStore,
  getStoreBySlug,
  getCurrentStore,
  updateStoreSettings,
  uploadStoreLogo,
  getStoreLogo,
  getStoreToken,
  requestUpgrade,
  resolveHost,
} from './store.controller';
import { resolveStore } from '../../middleware/resolveStore';
import { uploadImage } from '../../middleware/upload';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
// Ordered before '/:id' so the literal path is not swallowed by the param route.
router.get('/resolve', resolveHost);
router.get('/by-slug/:slug', getStoreBySlug);

// ── Public: get current store from X-Store-ID header ─────────────────────────
router.get('/current', resolveStore, getCurrentStore);

// ── Authenticated store owner ─────────────────────────────────────────────────
router.post('/', authenticateJWT, validate(createStoreSchema), createStore);
router.get('/mine', authenticateJWT, getMyStores);
router.get('/:id', authenticateJWT, validate(storeIdSchema), getMyStore);
router.put('/:id', authenticateJWT, validate(updateMyStoreSchema), updateMyStore);
router.delete('/:id', authenticateJWT, validate(storeIdSchema), deleteMyStore);

// ── Settings (owner or super-admin) ──────────────────────────────────────────
router.patch('/:id/settings', authenticateJWT, updateStoreSettings);
router.post('/:id/logo', authenticateJWT, uploadImage, uploadStoreLogo);
router.get('/:id/logo', getStoreLogo);  // public — redirects to Cloudinary URL
router.post('/:id/token', authenticateJWT, getStoreToken);

// ── Plan upgrade request (owner) ──────────────────────────────────────────────
router.post('/:id/upgrade-request', authenticateJWT, requestUpgrade);

// ── Super-admin ───────────────────────────────────────────────────────────────
// Both operate on an arbitrary store with no ownership check, so they must be
// platform-scoped. `authorizeRole('admin')` previously admitted every store
// owner, letting any tenant read all stores and deactivate a competitor's.
router.get('/', authenticateJWT, requireSuperAdmin, listAllStores);
router.patch('/:id/admin', authenticateJWT, requireSuperAdmin, validate(updateStoreSchema), adminUpdateStore);

export default router;
