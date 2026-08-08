import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticateJWT } from '../../middleware/authenticate';
import { authLimiter } from '../../middleware/rateLimiter';
import {
  refreshSchema,
  logoutSchema,
  resetPasswordSchema,
  platformLoginSchema,
} from './auth.schemas';
import {
  refreshHandler,
  logoutHandler,
  resetPasswordHandler,
  platformLoginHandler,
} from './auth.controller';

/**
 * Auth routes that are NOT scoped to a single store.
 *
 * Mounted at `/api/v1/auth`, outside the tenant router. Every route here
 * identifies its subject from something other than a store context — a refresh
 * cookie, an access token, or a single-use reset token.
 *
 * ⚠️  This file and `auth.tenant.routes.ts` must stay DISJOINT. They mount at
 * the same public prefix, and Express matches in registration order: a path
 * declared in both would be served here and would never receive a resolved
 * store. That is precisely how customer login ended up resolving globally by
 * email, letting one tenant's password authenticate another tenant's account.
 */
const router = Router();

// ── Platform sign-in ──────────────────────────────────────────────────────────
// Merchants and platform operators. Deliberately store-independent: a merchant
// may own several stores, and which one they are managing is chosen afterwards
// in the store switcher rather than by whichever URL they happened to visit.
router.post('/platform/login', authLimiter, validate(platformLoginSchema), platformLoginHandler);

// ── Session lifecycle ─────────────────────────────────────────────────────────
// The refresh cookie and the access token both carry their own subject, so no
// store context is required or wanted.
router.post('/refresh', authLimiter, validate(refreshSchema), refreshHandler);
router.post('/logout', authenticateJWT, validate(logoutSchema), logoutHandler);

// The reset token identifies exactly one account on its own — requiring a store
// here would break the link in an email opened on a different host.
router.post('/reset-password/:token', authLimiter, validate(resetPasswordSchema), resetPasswordHandler);

export default router;
