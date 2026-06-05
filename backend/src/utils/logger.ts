import winston from 'winston';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    json()
  ),
  defaultMeta: { service: 'ecommerce-api' },
  transports: [
    // Always log to stdout so Railway / any cloud platform picks up the logs.
    // In production we keep JSON format (structured); in dev we use colorized text.
    new winston.transports.Console({
      format: isProduction
        ? combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), json())
        : combine(colorize(), simple()),
    }),
  ],
});

// File transports are only useful when the container has a persistent filesystem.
// Skip them in production (Railway containers are ephemeral).
if (!isProduction) {
  logger.add(
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' })
  );
  logger.add(
    new winston.transports.File({ filename: 'logs/combined.log' })
  );
}

export { logger };
