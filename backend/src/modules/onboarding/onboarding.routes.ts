import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { onboardingSchema } from './onboarding.schemas';
import { handleOnboarding } from './onboarding.controller';

const router = Router();

/**
 * POST /api/v1/onboarding
 * Public — creates a store + admin owner in one atomic call.
 * No auth required (this IS the signup).
 */
router.post('/', validate(onboardingSchema), handleOnboarding);

export default router;
