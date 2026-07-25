import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().default('6379').transform((val) => parseInt(val, 10)),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/aegis_db'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_DEFAULT_OWNER: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  SLACK_WEBHOOK_URL: z.string().optional(),
  SLACK_BOT_TOKEN: z.string().optional(),
});

export const env = envSchema.parse(process.env);
