import rateLimit, { Options } from 'express-rate-limit';

/**
 * Rate limiters for endpoints that are expensive, abusable, or both.
 *
 * The global limiter in app.ts (300 req/min) exists to stop crude floods; it is
 * far too permissive for endpoints that spend money, send email, create
 * accounts, or can be used as a guessing oracle. Those get their own budget.
 */

function makeLimiter(windowMs: number, max: number, message: string, opts: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, code: 'RATE_LIMITED', message },
    ...opts,
  });
}

/**
 * Strict rate limiter for authentication endpoints.
 * Applied to /login, /register, /forgot-password, /reset-password.
 *
 * 10 failed attempts per 15-minute window per IP.
 * Successful requests do NOT count toward the limit.
 */
export const authLimiter = makeLimiter(
  15 * 60 * 1000,
  10,
  'Too many attempts, please try again in 15 minutes.',
  { skipSuccessfulRequests: true }
);

/**
 * Chatbot / AI endpoints.
 *
 * Every request is a paid OpenAI call billed to the platform owner, and the
 * endpoint is reachable without authentication. Under the global limit alone an
 * anonymous caller could drive 300 completions per minute per IP.
 */
export const aiLimiter = makeLimiter(
  15 * 60 * 1000,
  30,
  'Too many chat messages. Please wait a few minutes before trying again.'
);

/**
 * Public onboarding (store + owner-account creation).
 *
 * Unauthenticated and creates a privileged 'admin' user plus a store on every
 * call — the cheapest possible way to spam the platform with tenants.
 */
export const signupLimiter = makeLimiter(
  60 * 60 * 1000,
  5,
  'Too many stores created from this address. Please try again later.'
);

/**
 * Coupon code validation.
 *
 * Public, and returns distinct errors for "not found" / "expired" / "minimum
 * order", which makes it a usable oracle for brute-forcing valid codes.
 */
export const couponLimiter = makeLimiter(
  15 * 60 * 1000,
  20,
  'Too many coupon attempts. Please wait a few minutes before trying again.'
);

/**
 * Endpoints that send email on behalf of an anonymous caller
 * (newsletter subscribe/unsubscribe, contact-sales).
 *
 * Without a budget these are an open relay for mail-bombing a third party and a
 * fast way to burn the sending domain's reputation.
 */
export const emailLimiter = makeLimiter(
  60 * 60 * 1000,
  5,
  'Too many requests from this address. Please try again later.'
);
