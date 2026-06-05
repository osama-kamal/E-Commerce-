import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticateJWT } from '../../middleware/authenticate';
import { authLimiter } from '../../app';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from './auth.schemas';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from './auth.controller';

const router = Router();

// POST /api/v1/auth/register — brute-force limited
router.post('/register', authLimiter, validate(registerSchema), registerHandler);

// POST /api/v1/auth/login — brute-force limited
router.post('/login', authLimiter, validate(loginSchema), loginHandler);

// POST /api/v1/auth/refresh — cookie-based, no body needed
router.post('/refresh', validate(refreshSchema), refreshHandler);

// POST /api/v1/auth/logout  (requires valid access token)
router.post('/logout', authenticateJWT, validate(logoutSchema), logoutHandler);

// POST /api/v1/auth/forgot-password — brute-force limited (prevents email enumeration amplification)
router.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), forgotPasswordHandler);

// POST /api/v1/auth/reset-password/:token
router.post('/reset-password/:token', authLimiter, validate(resetPasswordSchema), resetPasswordHandler);

export default router;
