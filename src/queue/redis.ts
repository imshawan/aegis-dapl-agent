import { Redis } from 'ioredis';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export const redisClient = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null, // Required by BullMQ
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 3) {
      logger.warn('[Redis] Max connection retries exceeded. Offline mode engaged.');
      return null;
    }
    return Math.min(times * 100, 1000);
  },
});

redisClient.on('connect', () => {
  logger.info('[Redis] Connected successfully');
});

redisClient.on('error', (err) => {
  logger.error(`[Redis] Connection error: ${err.message}`);
});


