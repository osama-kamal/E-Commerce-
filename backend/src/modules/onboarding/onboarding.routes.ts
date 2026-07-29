import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { signupLimiter } from '../../middleware/rateLimiter';
import { onboardingSchema } from './onboarding.schemas';
import { handleOnboarding } from './onboarding.controller';

const router = Router();

/**
 * POST /api/v1/onboarding
 * Public — creates a store + admin owner in one atomic call.
 * No auth required (this IS the signup).
 */
// Rate limited: this is unauthenticated and mints an 'admin' user + a store.
router.post('/', signupLimiter, validate(onboardingSchema), handleOnboarding);

export default router;
