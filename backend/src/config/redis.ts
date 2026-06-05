import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { REDIS_URL } from './index';

let redisClient: Redis | null = null;
let redisAvailable = true;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,   // fail fast instead of queuing when disconnected
      connectTimeout: 3000,        // give up connecting after 3 seconds
      retryStrategy(times) {
        if (times > 2) {
          // Stop retrying after 2 attempts — mark Redis as unavailable
          redisAvailable = false;
          return null; // stop retrying
        }
        return Math.min(times * 500, 1000);
      },
      maxRetriesPerRequest: null,  // don't throw MaxRetriesPerRequestError — let commands fail silently
    });

    redisClient.on('connect', () => {
      redisAvailable = true;
      logger.info('✅ Redis connected successfully');
    });

    redisClient.on('error', (err) => {
      redisAvailable = false;
      logger.error('Redis connection error', { error: err });
    });

    redisClient.on('close', () => {
      redisAvailable = false;
      logger.warn('Redis connection closed');
    });
  }

  return redisClient;
}

/** Returns true if Redis is currently reachable */
export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  try {
    await client.connect();
    redisAvailable = true;
  } catch (err) {
    redisAvailable = false;
    logger.warn('Redis unavailable — running without session cache. Refresh tokens will use DB only.');
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      // ignore disconnect errors
    }
    redisClient = null;
    redisAvailable = false;
    logger.info('Redis disconnected gracefully');
  }
}
