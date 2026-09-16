/**
 * Sentry bootstrap — MUST be the first import in server.ts.
 *
 * The SDK auto-instruments express, mongoose and the HTTP client by patching
 * them as they load. Anything imported before `Sentry.init()` runs is therefore
 * never instrumented, and the failure mode is silent: errors still report, but
 * without request context or database spans, and nothing warns you.
 *
 * This file exists solely so that ordering is enforced by a single
 * `import './instrument'` at the top of the entrypoint, rather than by hoping
 * nobody reorders the imports in server.ts.
 *
 * It is deliberately NOT imported by app.ts. app.ts is pulled in by ~20 test
 * suites, and initialising an error tracker as a side effect of importing the
 * app would fire on every one of them.
 */

import { initSentry } from './config/sentry';

const active = initSentry();

if (active) {
  // eslint-disable-next-line no-console
  console.log('✅  Sentry initialised — errors will be reported');
} else if (process.env.NODE_ENV === 'production') {
  // Loud, because this is the configuration you most want to get wrong only
  // once: a production deploy with no crash reporting looks perfectly healthy.
  // eslint-disable-next-line no-console
  console.warn('⚠️   SENTRY_DSN not set — running in production with NO error tracking');
}

export { active as sentryActive };
