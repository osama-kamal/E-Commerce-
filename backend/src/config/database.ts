import mongoose from 'mongoose';
import { logger } from '../utils/logger';
import { config } from './index';

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

async function connectWithRetry(attempt = 1): Promise<void> {
  // Read from config object (not the destructured named export) so the
  // MONGO_URI → MONGODB_URI alias override is always reflected here.
  const uri = config.MONGODB_URI;

  // Redact the password from the URI for safe logging
  const safeUri = uri.replace(/:([^@]+)@/, ':***@');
  logger.info(`[DB] Connecting to MongoDB (attempt ${attempt}/${MAX_RETRIES}): ${safeUri}`);

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000, // 10 s — gives Atlas more time to respond
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    logger.info('✅ MongoDB connected successfully');
  } catch (error) {
    // Log the full error so Railway's log viewer shows the exact failure reason.
    // Common causes:
    //   MongoServerSelectionError: connection timed out  → Atlas IP whitelist blocking Railway
    //   MongoServerError: Authentication failed          → wrong password in MONGODB_URI
    //   getaddrinfo ENOTFOUND                           → wrong cluster hostname
    const err = error as Error;
    const errorDetail = `[${err.name}] ${err.message}`;

    if (attempt >= MAX_RETRIES) {
      logger.error(`❌ MongoDB connection failed after ${MAX_RETRIES} attempts. Last error: ${errorDetail}`, { error });
      console.error(`\n❌ FATAL: Could not connect to MongoDB after ${MAX_RETRIES} attempts.`);
      console.error(`   Error type : ${err.name}`);
      console.error(`   Error msg  : ${err.message}`);
      console.error(`   URI used   : ${safeUri}`);
      console.error(`   If you see "connection timed out", your MongoDB Atlas Network Access`);
      console.error(`   does not allow Railway's IP. Add 0.0.0.0/0 in Atlas → Network Access.\n`);
      throw error;
    }

    logger.warn(
      `⚠️  MongoDB attempt ${attempt}/${MAX_RETRIES} failed (${errorDetail}). Retrying in ${RETRY_DELAY_MS / 1000}s...`,
      { error }
    );

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return connectWithRetry(attempt + 1);
  }
}

export async function connectDatabase(): Promise<void> {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected — will reconnect automatically');
  });

  mongoose.connection.on('error', (err) => {
    logger.error(`MongoDB connection error: [${err.name}] ${err.message}`, { error: err });
  });

  await connectWithRetry();
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected gracefully');
}
