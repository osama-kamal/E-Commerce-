import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { createStoreSchema, updateStoreSchema, storeIdSchema } from './store.schemas';
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
} from './store.controller';
import { resolveStore } from '../../middleware/resolveStore';
import { uploadImage } from '../../middleware/upload';

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/by-slug/:slug', getStoreBySlug);

// ── Public: get current store from X-Store-ID header ─────────────────────────
router.get('/current', resolveStore, getCurrentStore);

// ── Authenticated store owner ─────────────────────────────────────────────────
router.post('/', authenticateJWT, validate(createStoreSchema), createStore);
router.get('/mine', authenticateJWT, getMyStores);
router.get('/:id', authenticateJWT, validate(storeIdSchema), getMyStore);
router.put('/:id', authenticateJWT, validate(updateStoreSchema), updateMyStore);
router.delete('/:id', authenticateJWT, validate(storeIdSchema), deleteMyStore);

// ── Settings (owner or super-admin) ──────────────────────────────────────────
router.patch('/:id/settings', authenticateJWT, updateStoreSettings);
router.post('/:id/logo', authenticateJWT, uploadImage, uploadStoreLogo);
router.get('/:id/logo', getStoreLogo);  // public — redirects to Cloudinary URL
router.post('/:id/token', authenticateJWT, getStoreToken);

// ── Plan upgrade request (owner) ──────────────────────────────────────────────
router.post('/:id/upgrade-request', authenticateJWT, requestUpgrade);

// ── Super-admin ───────────────────────────────────────────────────────────────
router.get('/', authenticateJWT, authorizeRole('admin'), listAllStores);
router.patch('/:id/admin', authenticateJWT, authorizeRole('admin'), validate(updateStoreSchema), adminUpdateStore);

export default router;
