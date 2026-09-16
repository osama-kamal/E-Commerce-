import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authLimiter } from '../../middleware/rateLimiter';
import { registerSchema, loginSchema, forgotPasswordSchema } from './auth.schemas';
import { registerHandler, loginHandler, forgotPasswordHandler } from './auth.controller';

/**
 * Auth routes that operate on ONE STORE.
 *
 * Mounted inside the tenant router, so `resolveStore` has already run and
 * `req.store` is populated — from `X-Store-ID`, `X-Store-Slug`, a subdomain, or
 * a custom domain, uniformly.
 *
 * ── Why this file was split out ───────────────────────────────────────────────
 * `authRoutes` used to carry every auth route and was mounted twice: once at
 * `/api/v1/auth` (no store resolution) and once inside the tenant router.
 * Express matches in registration order, so the first mount always won and the
 * tenant-scoped one was unreachable. `req.store` was therefore undefined for
 * EVERY login, and resolution silently fell through to a global by-email lookup.
 *
 * The consequences were not subtle: a customer whose address collided with any
 * older or more privileged account could not log into their own store at all,
 * and a shopper's login form would happily authenticate an admin account
 * belonging to a different tenant.
 *
 * Keeping the two route sets DISJOINT is what makes both mounts work. A router
 * calls `next()` when nothing matches, so a request for `/api/v1/auth/login`
 * passes through the store-independent mount and lands here with a resolved
 * store. Adding a path to both files would silently reintroduce the bug —
 * `login-tenant-scope.integration.test.ts` guards against exactly that.
 */
const router = Router();

// Creates a CUSTOMER of the resolved store.
router.post('/register', authLimiter, validate(registerSchema), registerHandler);

// Customer sign-in, scoped strictly to the resolved store. Merchants and
// platform operators use POST /auth/platform/login instead.
router.post('/login', authLimiter, validate(loginSchema), loginHandler);

// Reset tokens are issued against a specific store's account, so this needs the
// store context too — the same address can hold accounts in several stores.
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);

export default router;
