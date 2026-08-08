// MUST stay first — the Sentry SDK instruments express/mongoose as they load,
// so anything imported above this line runs uninstrumented. See instrument.ts.
import './instrument';

import { config } from './config/index';
import { captureError, flushSentry } from './config/sentry';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { logger } from './utils/logger';
import { emailService } from './services/email.service';
import app from './app';
import { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';

async function bootstrap(): Promise<void> {
  // ── 1. Bind the HTTP server FIRST ─────────────────────────────────────────
  // Railway's health check fires within seconds of deployment.
  // If we wait for MongoDB before binding the port, the health check times out
  // → "Service unavailable". Start listening immediately; DB connects in step 2.
  const server: http.Server<typeof IncomingMessage, typeof ServerResponse> = app.listen(
    config.PORT,
    () => {
      logger.info(`🚀 Server bound on port ${config.PORT} [${config.NODE_ENV}] — connecting to DB...`);
    }
  );

  // Handle port-already-in-use (can happen on Railway if a previous container
  // hasn't fully stopped yet)
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`❌ Port ${config.PORT} is already in use.`);
      process.exit(1);
    } else {
      logger.error('HTTP server error', { error: err });
      process.exit(1);
    }
  });

  // ── 2. Connect to MongoDB (after port is bound) ───────────────────────────
  try {
    await connectDatabase();
  } catch (dbError) {
    // DB connection exhausted all retries — log clearly and exit so Railway
    // restarts the container. The HTTP server was already serving; this ensures
    // a clean restart rather than a half-alive process.
    logger.error('❌ Database connection failed — shutting down server', { error: dbError });
    server.close(() => process.exit(1));
    return;
  }

  // ── 3. Connect to Redis (optional — degrades gracefully if unavailable) ───
  try {
    await connectRedis();
  } catch (redisError) {
    logger.warn('Redis unavailable — refresh tokens disabled', { error: redisError });
  }

  // ── 4. Verify email SMTP (non-blocking) ───────────────────────────────────
  emailService.verifyConnection();

  // ── 5. Register dunning job — runs every hour after DB is connected ───────
  // Finds all stores that have been past_due for > 7 days and promotes them
  // to 'suspended'. Pure MongoDB bulk-update — no Stripe API calls.
  const { runDunningJob } = await import('./modules/payments/subscription.service');
  setInterval(runDunningJob, 60 * 60 * 1000).unref();
  logger.info('⏱️  Dunning job registered — runs every 60 minutes');

  // ── 6. Release inventory held by abandoned checkouts ──────────────────────
  // placeOrder decrements stock before payment, so an abandoned online checkout
  // would hold units indefinitely. Runs every 5 minutes; COD orders are exempt.
  const { expireStalePendingOrders } = await import('./modules/orders/order.service');
  setInterval(() => {
    expireStalePendingOrders().catch((err) =>
      logger.error('Pending-order expiry job failed', { error: (err as Error).message })
    );
  }, 5 * 60 * 1000).unref();
  logger.info(
    `⏱️  Pending-order expiry registered — runs every 5 minutes (TTL ${config.PENDING_ORDER_TTL_MINUTES}m)`
  );

  logger.info('✅ All services connected — server is fully ready');

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down gracefully…`);

    if (typeof (server as unknown as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
      (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
    }

    server.close(async () => {
      try {
        const { disconnectDatabase } = await import('./config/database');
        const { disconnectRedis } = await import('./config/redis');
        // Flushed FIRST, and before the process can exit. Sentry transmits in
        // the background, so an unflushed report dies with the container —
        // losing precisely the crash that caused the shutdown.
        await flushSentry();
        await disconnectDatabase();
        await disconnectRedis();
        logger.info('Server shut down cleanly');
      } catch (e) {
        logger.error('Error during shutdown', { error: e });
      } finally {
        process.exit(0);
      }
    });

    setTimeout(() => {
      logger.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  // Both are reported explicitly rather than left to Sentry's global handlers,
  // so they carry the same `errorCode` tagging as request errors and stay
  // greppable alongside the log line.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason });
    captureError(reason, { errorCode: 'UNHANDLED_REJECTION' });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err });
    captureError(err, { errorCode: 'UNCAUGHT_EXCEPTION' });
    shutdown('uncaughtException').catch(() => process.exit(1));
  });
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
