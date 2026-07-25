import mongoose from 'mongoose';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export async function connectToDatabase(): Promise<typeof mongoose> {
  try {
    const conn = await mongoose.connect(env.MONGODB_URI);
    logger.info(`[MongoDB] Connected to database: ${conn.connection.name}`);
    return conn;
  } catch (error: any) {
    logger.error(`[MongoDB] Connection error: ${error.message}`);
    throw error;
  }
}


