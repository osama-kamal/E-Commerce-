import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { resolveSubscriptionAccess } from '../modules/stores/subscription-access';
import { createError } from './errorHandler';

/**
 * Enforces the subscription state of the resolved tenant.
 *
 * Mounted on the tenant router immediately after `resolveStore`, so every
 * store-scoped route is covered by construction rather than by remembering to
 * add a guard per route. `subscriptionStatus` was previously written by the
 * Stripe webhooks and the dunning job and never read anywhere on the server —
 * a suspended, non-paying store kept 100% of its API access.
 *
 * ── What is blocked ───────────────────────────────────────────────────────────
 * Only `level: 'restricted'` (i.e. `subscriptionStatus === 'suspended'`) is
 * gated, and even then reads are preserved:
 *
 *   • GET / HEAD / OPTIONS → always allowed. The storefront stays browsable, so
 *     indexed URLs keep resolving and existing customers can still see their
 *     order history. Cutting these would punish the merchant's customers for
 *     the merchant's billing problem.
 *   • Everything else      → HTTP 402 SUBSCRIPTION_REQUIRED.
 *
 * 402 rather than 403: this is not an authorisation failure, and conflating the
 * two would make the client's generic 403 handling show "you do not have
 * permission" to a merchant whose card simply expired.
 *
 * ── What is deliberately NOT blocked ─────────────────────────────────────────
 * The billing escape hatch. A merchant who cannot pay you is worthless, so
 * every route that leads to money must stay reachable:
 *
 *   • `/auth/*` — exempted below. Both the merchant and their customers must be
 *     able to sign in; the dashboard's own recovery flow starts with a login.
 *   • `POST /stores/:id/upgrade-request`, `GET /plans`, `GET /stores/mine`,
 *     `GET /stores/current` — these are mounted OUTSIDE the tenant router in
 *     app.ts and therefore never reach this middleware at all. That is load-
 *     bearing, not incidental: `subscription-billing-escape-hatch` in the
 *     integration tests pins it so a future refactor cannot quietly move them
 *     behind the gate.
 *   • `/payments/*` — also mounted outside (it needs the raw body for webhook
 *     HMAC). An already-placed order can still be paid; the store is blocked
 *     from taking NEW orders, not from settling existing obligations.
 *
 * ── Super-admin ───────────────────────────────────────────────────────────────
 * A platform operator can act on a suspended tenant for support. The token is
 * peeked at here because `authenticateJWT` runs per-route further down the
 * stack, so `req.user` is not populated yet. The peek is signature-verified and
 * can only ever LOOSEN this gate — it grants nothing on its own, and the real
 * authentication still happens downstream. Any failure falls through to the
 * normal restricted path.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Path prefixes (relative to the tenant router mount) that bypass the gate
 * entirely, for any method.
 */
const EXEMPT_PREFIXES = ['/auth'];

function isExemptPath(path: string): boolean {
  return EXEMPT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * Signature-verified peek at the bearer token purely to spot a platform
 * operator. Never throws — an absent, malformed, or expired token simply means
 * "not a super-admin" and the caller continues down the normal path.
 */
function isSuperAdminToken(req: Request): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  try {
    return verifyAccessToken(header.slice(7)).role === 'super-admin';
  } catch {
    return false;
  }
}

export function enforceSubscription(req: Request, _res: Response, next: NextFunction): void {
  // No tenant resolved means this is not a store-scoped request; nothing to
  // enforce. resolveStore runs first and 404s an unknown store, so in practice
  // this only guards against the middleware being mounted somewhere unexpected.
  if (!req.store) return next();

  const access = resolveSubscriptionAccess(req.store);

  // Attach for downstream consumers (controllers, quota checks) so nothing has
  // to resolve this a second time and risk drifting.
  req.subscription = access;

  if (access.level !== 'restricted') return next();
  if (READ_METHODS.has(req.method)) return next();
  if (isExemptPath(req.path)) return next();
  if (isSuperAdminToken(req)) return next();

  return next(
    createError(
      'This store is not currently accepting orders or changes. ' +
        'The store owner needs to update their subscription to restore full access.',
      402,
      'SUBSCRIPTION_REQUIRED',
      { reason: access.reason, effectivePlan: access.effectivePlan }
    )
  );
}
