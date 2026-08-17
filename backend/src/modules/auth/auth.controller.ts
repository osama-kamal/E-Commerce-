import { Request, Response, NextFunction } from 'express';
import * as authService from './auth.service';
import { sendSuccess } from '../../utils/response';
import { createError } from '../../middleware/errorHandler';
import { NODE_ENV } from '../../config';

// ── Cookie config ──────────────────────────────────────────────────────────────
// The refresh token lives exclusively in an httpOnly cookie — it is never
// included in the JSON response body, which mitigates XSS token theft.

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function setRefreshCookie(res: Response, token: string): void {
  const isProd = NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,          // not accessible via document.cookie
    secure: isProd,          // HTTPS only in prod
    // 'none' required for cross-site requests (Vercel frontend → Railway backend).
    // 'lax' is safe enough for local dev (same-site).
    sameSite: isProd ? 'none' : 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: '/api/v1/auth',    // limit scope to auth endpoints only
  });
}

function clearRefreshCookie(res: Response): void {
  const isProd = NODE_ENV === 'production';
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/api/v1/auth',
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getStoreId(req: Request): string {
  // Primary: resolved by resolveStore middleware
  const fromStore = req.store?._id?.toString();
  if (fromStore) return fromStore;

  // Fallback: read directly from X-Store-ID header (for routes registered
  // outside the tenantRouter, e.g. /api/v1/auth before resolveStore runs)
  const fromHeader = req.headers['x-store-id'] as string | undefined;
  if (fromHeader && /^[a-f\d]{24}$/i.test(fromHeader)) return fromHeader;

  throw createError('Store context is required', 400, 'BAD_REQUEST');
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function registerHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const { user, tokens } = await authService.register(getStoreId(req), email, password);

    // Set refresh token as httpOnly cookie — never exposed in the response body
    setRefreshCookie(res, tokens.refreshToken);

    // Return only the access token + user in the body
    sendSuccess(res, { user, accessToken: tokens.accessToken }, 201);
  } catch (err) {
    next(err);
  }
}

export async function loginHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    // `getStoreId` rather than reading `req.store` directly. That direct read
    // was the bug: this route is now mounted inside the tenant router so
    // resolveStore populates it, but the helper also throws a clear 400 if the
    // store context is ever missing again, instead of silently passing null
    // into a global lookup.
    const { user, tokens } = await authService.login(getStoreId(req), email, password);

    setRefreshCookie(res, tokens.refreshToken);
    sendSuccess(res, { user, accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
}

/**
 * Platform sign-in for merchants and platform operators.
 *
 * Takes no store context on purpose — see `authService.platformLogin`. Kept
 * separate from `loginHandler` so the two authentication decisions cannot be
 * confused in review; collapsing them into one endpoint is how the cross-tenant
 * escalation got in.
 */
export async function platformLoginHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const { user, tokens } = await authService.platformLogin(email, password);

    setRefreshCookie(res, tokens.refreshToken);
    sendSuccess(res, { user, accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function refreshHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Read refresh token from httpOnly cookie (preferred) or body (legacy fallback
    // for clients that haven't migrated yet — remove body fallback after full rollout)
    const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    const bodyToken = (req.body as { refreshToken?: string }).refreshToken;
    const rawRefreshToken = cookieToken ?? bodyToken;

    if (!rawRefreshToken) {
      return next(createError('Refresh token is required', 401, 'UNAUTHORIZED'));
    }

    const tokens = await authService.refresh(rawRefreshToken);

    // Rotate: set new refresh cookie and return new access token
    setRefreshCookie(res, tokens.refreshToken);
    sendSuccess(res, { accessToken: tokens.accessToken });
  } catch (err) {
    next(err);
  }
}

export async function logoutHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Accept token from cookie (preferred) or body (legacy)
    const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    const bodyToken = (req.body as { refreshToken?: string }).refreshToken;
    const rawRefreshToken = cookieToken ?? bodyToken;

    const userId = req.user!.userId.toString();
    if (rawRefreshToken) {
      await authService.logout(userId, rawRefreshToken);
    }

    clearRefreshCookie(res);
    sendSuccess(res, { message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

export async function forgotPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email } = req.body as { email: string };
    await authService.forgotPassword(getStoreId(req), email);
    // Always return the same message — prevents email enumeration
    sendSuccess(res, {
      message: 'If that email is registered, a reset link has been sent.',
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { token } = req.params as { token: string };
    const { password } = req.body as { password: string };
    await authService.resetPassword(token, password);
    sendSuccess(res, { message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
}
