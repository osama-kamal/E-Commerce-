import { Router } from 'express';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  quoteSchema,
  createZoneSchema,
  updateZoneSchema,
  zoneIdSchema,
  createRateSchema,
  updateRateSchema,
  rateIdSchema,
  listRatesSchema,
} from './shipping.schemas';
import {
  quoteShipping,
  listZones,
  createZone,
  updateZone,
  deleteZone,
  listRates,
  createRate,
  updateRate,
  deleteRate,
} from './shipping.controller';

const router = Router();

// ── Storefront ────────────────────────────────────────────────────────────────
// Authenticated: the quote is priced against the caller's own cart, which is
// how the subtotal stays server-derived rather than client-supplied.
router.post('/quote', authenticateJWT, validate(quoteSchema), quoteShipping);

// ── Merchant configuration ────────────────────────────────────────────────────
// Zones and rates decide what customers are charged for delivery, so they are
// admin-only. `authorizeRole('admin')` is tenant-scoped — an admin OF THIS
// STORE, cross-checked against the resolved store by authenticateJWT.
router.get('/zones', authenticateJWT, authorizeRole('admin'), listZones);
router.post('/zones', authenticateJWT, authorizeRole('admin'), validate(createZoneSchema), createZone);
router.put('/zones/:id', authenticateJWT, authorizeRole('admin'), validate(updateZoneSchema), updateZone);
router.delete('/zones/:id', authenticateJWT, authorizeRole('admin'), validate(zoneIdSchema), deleteZone);

router.get('/rates', authenticateJWT, authorizeRole('admin'), validate(listRatesSchema), listRates);
router.post('/rates', authenticateJWT, authorizeRole('admin'), validate(createRateSchema), createRate);
router.put('/rates/:id', authenticateJWT, authorizeRole('admin'), validate(updateRateSchema), updateRate);
router.delete('/rates/:id', authenticateJWT, authorizeRole('admin'), validate(rateIdSchema), deleteRate);

export default router;
