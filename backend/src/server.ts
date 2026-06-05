import { config } from './config/index';
import { connectDatabase } from './config/database';
import { connectRedis } from './config/redis';
import { logger } from './utils/logger';
import { emailService } from './services/email.service';
import app from './app';
import { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();

    try {
      await connectRedis();
    } catch (redisError) {
      logger.warn('Redis unavailable — refresh tokens disabled', { error: redisError });
    }

    const server: http.Server<typeof IncomingMessage, typeof ServerResponse> = app.listen(config.PORT, () => {
      logger.info(`🚀 Server running on port ${config.PORT} [${config.NODE_ENV}]`);
    });

    // Verify email SMTP connection (non-blocking)
    emailService.verifyConnection();

    // Handle port-already-in-use gracefully
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${config.PORT} is already in use. Kill the existing process and restart.`);
        process.exit(1);
      } else {
        throw err;
      }
    });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} received — shutting down gracefully…`);

      // closeAllConnections() forces keep-alive sockets closed (Node 18+)
      if (typeof (server as unknown as { closeAllConnections?: () => void }).closeAllConnections === 'function') {
        (server as unknown as { closeAllConnections: () => void }).closeAllConnections();
      }

      server.close(async () => {
        try {
          const { disconnectDatabase } = await import('./config/database');
          const { disconnectRedis } = await import('./config/redis');
          await disconnectDatabase();
          await disconnectRedis();
          logger.info('Server shut down cleanly');
        } catch (e) {
          logger.error('Error during shutdown', { error: e });
        } finally {
          process.exit(0);
        }
      });

      // Force-exit after 10 s if graceful shutdown hangs
      setTimeout(() => {
        logger.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, 10_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    // Prevent unhandled rejections from crashing the process silently
    // (they would leave the port open without releasing it)
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection', { reason });
      // Do NOT exit — let the request fail normally via the error handler
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception', { error: err });
      // Exit cleanly so the port is released and ts-node-dev can restart
      shutdown('uncaughtException').catch(() => process.exit(1));
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

bootstrap();
