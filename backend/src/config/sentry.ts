/**
 * Sentry error tracking.
 *
 * ── What this replaces ────────────────────────────────────────────────────────
 * Nothing. There was no error tracking of any kind: a 500 in production wrote a
 * line to `logs/combined.log` inside an ephemeral container and that was the
 * entire signal. Nobody is paged, nothing is aggregated, and a restart erases
 * it. This is the difference between "a customer told us checkout is broken"
 * and knowing at the first occurrence.
 *
 * ── Absent DSN means absent SDK ───────────────────────────────────────────────
 * `initSentry()` returns false and every other export becomes a no-op when
 * `SENTRY_DSN` is unset. Development, tests and CI therefore run exactly as
 * before — no network calls, no init, no console noise. This mirrors how the
 * codebase treats Redis, Cloudinary and the payment gateways.
 *
 * ── PII ───────────────────────────────────────────────────────────────────────
 * This is the part that matters, and the reason the scrubbing below is
 * deny-by-default rather than a list of known-bad keys.
 *
 * An error tracker is a firehose pointed at a third party: by default Sentry
 * attaches the request that produced the error, and this API's requests carry
 * shipping addresses, email addresses, coupon codes and bearer tokens. Sending
 * an order to Sentry would undo the redaction work done in the checkout logger
 * for exactly the same data.
 *
 * So:
 *   • `sendDefaultPii: false` — no IP addresses, no cookies, no headers by default
 *   • request BODIES are dropped wholesale in `beforeSend` — never allow-listed,
 *     because a body is where addresses and card-adjacent data live
 *   • query strings are dropped — `?email=` in a support link is enough
 *   • the Authorization and Cookie headers are removed explicitly, in case a
 *     future integration re-enables header capture
 *
 * What IS sent: the exception and stack, the route template, the HTTP method,
 * the status code, and pseudonymous `userId` / `storeId` identifiers. Those
 * identifiers are the whole point — without them an issue cannot be traced to a
 * tenant — and they are opaque ObjectIds, not names or addresses.
 */

import * as Sentry from '@sentry/node';
import { config } from './index';

let enabled = false;

/** Headers that must never leave the process, even if header capture is on. */
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-paymob-hmac',
  'stripe-signature',
];

/**
 * Strips everything personal from an event before it leaves the process.
 *
 * Exported and pure so the redaction can be tested directly, without a DSN, a
 * network, or an initialised SDK. This is the security-critical half of the
 * integration — if it regresses, customer addresses start flowing to a third
 * party — so it should not only be reachable through `Sentry.init`.
 *
 * Wired in as `beforeSend`, which runs for EVERY event regardless of how it was
 * captured, so a future integration that starts attaching request data cannot
 * route around it.
 */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    // The body. Dropped entirely — shipping addresses, emails, coupon codes.
    // There is no version of this worth keeping.
    delete event.request.data;

    // Query strings. `?token=`, `?email=` — same reasoning.
    delete event.request.query_string;

    if (event.request.headers) {
      for (const header of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADERS.includes(header.toLowerCase())) {
          delete event.request.headers[header];
        }
      }
    }

    // A URL can carry a token in its query or fragment; keep only the path.
    if (typeof event.request.url === 'string') {
      event.request.url = event.request.url.split(/[?#]/)[0];
    }
  }

  // Sentry's own user model carries email, username and ip_address. We only
  // ever set `id`, but an auto-instrumented integration could populate the
  // rest, so they are stripped here rather than trusted not to appear.
  if (event.user) {
    event.user = { id: event.user.id };
  }

  // Breadcrumbs record outbound HTTP and DB calls, which can echo the same data
  // back in. Keep the shape, drop the payload.
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => {
      if (!crumb.data) return crumb;
      const { url, method, status_code } = crumb.data as Record<string, unknown>;
      return { ...crumb, data: { url, method, status_code } };
    });
  }

  return event;
}

/**
 * Initialises the SDK. Safe to call more than once; only the first call binds.
 *
 * Must run BEFORE express and mongoose are imported for auto-instrumentation to
 * attach, which is why `src/instrument.ts` exists and is the first import in
 * server.ts rather than this being called from inside app.ts.
 *
 * @returns whether Sentry is now active
 */
export function initSentry(): boolean {
  if (enabled) return true;
  if (!config.SENTRY_DSN) return false;

  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    release: config.SENTRY_RELEASE,

    // Never attach IPs, cookies or headers automatically. See the header.
    sendDefaultPii: false,

    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,

    beforeSend: scrubEvent,
  });

  enabled = true;
  return true;
}

/** Whether the SDK is active. False in development, tests and CI. */
export function isSentryEnabled(): boolean {
  return enabled;
}

export interface ErrorContext {
  /** Pseudonymous account identifier — an ObjectId, never an email. */
  userId?: string;
  /** Tenant the request resolved to, so issues can be grouped per merchant. */
  storeId?: string;
  method?: string;
  /** Route path only — never the query string. */
  route?: string;
  statusCode?: number;
  /** Application error code, e.g. DATABASE_ERROR. Becomes a searchable tag. */
  errorCode?: string;
}

/**
 * Reports an error, with tenant context attached.
 *
 * A no-op when Sentry is inactive, so callers never need to check first.
 */
export function captureError(error: unknown, context: ErrorContext = {}): void {
  if (!enabled) return;

  Sentry.withScope((scope) => {
    if (context.userId || context.storeId) {
      // `id` only. Sentry's user model also carries email/ip_address/username;
      // populating those is what turns an issue list into a customer database.
      scope.setUser({ id: context.userId ?? undefined });
    }

    if (context.storeId) scope.setTag('storeId', context.storeId);
    if (context.errorCode) scope.setTag('errorCode', context.errorCode);
    if (context.statusCode) scope.setTag('statusCode', String(context.statusCode));
    if (context.method && context.route) {
      scope.setTag('route', `${context.method} ${context.route}`);
    }

    Sentry.captureException(error);
  });
}

/**
 * Flushes buffered events before the process exits.
 *
 * Sentry sends in the background, so an unflushed crash report dies with the
 * container — which is precisely the crash you most wanted to see. Called from
 * the shutdown path in server.ts.
 */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // Shutdown must not be blocked by the error tracker.
  }
}

export { Sentry };
