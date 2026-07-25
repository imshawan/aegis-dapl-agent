import { Redis } from 'ioredis';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export const redisClient = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  maxRetriesPerRequest: null, // Required by BullMQ
});

redisClient.on('connect', () => {
  logger.info('[Redis] Connected successfully');
});

redisClient.on('error', (err) => {
  logger.error(`[Redis] Connection error: ${err.message}`);
});


