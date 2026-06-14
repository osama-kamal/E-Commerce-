import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate';
import { authenticateJWT, authorizeRole } from '../../middleware/authenticate';
import { listPlanConfigs, updatePlanConfig } from './plan.controller';

const router = Router();

const updatePlanSchema = z.object({
  params: z.object({
    planId: z.enum(['free', 'starter', 'pro', 'enterprise']),
  }),
  body: z
    .object({
      displayName: z.string().min(1).max(60).optional(),
      price: z.string().min(1).max(20).optional(),
      period: z.string().max(20).optional(),
      features: z.array(z.string().max(200)).optional(),
      badge: z.string().max(60).nullable().optional(),
      ctaLabel: z.string().min(1).max(60).optional(),
      isContactSales: z.boolean().optional(),
      isHighlighted: z.boolean().optional(),
      sortOrder: z.number().int().min(0).optional(),
    })
    .refine(obj => Object.keys(obj).length > 0, {
      message: 'At least one field must be provided',
    }),
});

// GET /api/v1/plans — public, no auth
router.get('/', listPlanConfigs);

// PUT /api/v1/plans/:planId — super-admin and admin
// (The Plan Editor page is already guarded by PlatformAdminRoute on the frontend;
// the backend accepts 'admin' too so the request works even when a store-scoped
// token is in use during platform admin sessions.)
router.put(
  '/:planId',
  authenticateJWT,
  authorizeRole('super-admin', 'admin'),
  validate(updatePlanSchema),
  updatePlanConfig
);

export default router;
