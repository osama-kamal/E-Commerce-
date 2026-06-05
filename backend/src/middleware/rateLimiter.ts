import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for authentication endpoints.
 * Applied to /login, /register, /forgot-password, /reset-password.
 *
 * 10 failed attempts per 15-minute window per IP.
 * Successful requests do NOT count toward the limit.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 10,                   // 10 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failures toward the limit
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: 'Too many attempts, please try again in 15 minutes.',
  },
});
