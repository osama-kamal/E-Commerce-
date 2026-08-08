import api from './axios';
import axios from 'axios';
import { User } from '../types';

type Session = { data: { user: User; accessToken: string } };

/**
 * Authentication API.
 *
 * ── Two surfaces, deliberately ────────────────────────────────────────────────
 * `login` is for SHOPPERS and is scoped to one store. `platformLogin` is for
 * MERCHANTS and platform operators and carries no store context at all.
 *
 * This file previously had a single `login` that stripped the store headers on
 * purpose, so the server would "always find the admin-role document regardless
 * of which store the browser thinks is active". That workaround existed because
 * the server resolved logins globally by email — which meant a shopper's
 * password could authenticate an admin account in a different tenant, and,
 * far more often, a customer whose address collided with any other account
 * could not sign in to their own store at all.
 *
 * The server now scopes storefront login strictly to `{ storeId, email }`, so
 * sending the store context is required rather than something to work around.
 */
export const authApi = {
  register: (email: string, password: string) =>
    api.post<{ data: { user: User; accessToken: string; refreshToken: string } }>(
      '/auth/register', { email, password }
    ),

  /**
   * Customer sign-in on a storefront.
   *
   * Uses the shared instance so the interceptor attaches the tenant — by slug
   * inside `/s/:slug`, by id on a host-resolved storefront. Without it the
   * server returns 400 rather than guessing, which is the point.
   */
  login: (email: string, password: string) =>
    api.post<Session>('/auth/login', { email, password }),

  /**
   * Merchant and operator sign-in on the platform host.
   *
   * Bare axios with NO store headers: this authenticates a person against their
   * own account, and which of their stores they then manage is chosen in the
   * store switcher. Routing it through the shared instance would attach
   * whatever tenant happened to be cached and defeat that.
   */
  platformLogin: (email: string, password: string) =>
    axios.post<Session>(
      '/api/v1/auth/platform/login',
      { email, password },
      {
        withCredentials: true, // needed for the httpOnly refresh-token cookie
        headers: { 'Content-Type': 'application/json' },
      }
    ),

  // No argument: the refresh token travels in the httpOnly cookie, which axios
  // sends automatically (withCredentials). The old signature took a token read
  // from localStorage — a key that is never written, so callers guarded on a
  // value that was always null and the request never went out.
  logout: () => api.post('/auth/logout'),

  /** Store-scoped: the same address may hold accounts in several stores. */
  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),

  /** The reset token identifies one account on its own — no store context. */
  resetPassword: (token: string, password: string) =>
    api.post(`/auth/reset-password/${token}`, { password }),
};
