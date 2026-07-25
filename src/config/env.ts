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
  APP_NAME: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export const env: EnvConfig = envSchema.parse(process.env);

/**
 * Generic config getter by key.
 */
export function getConfig<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
  return env[key];
}

/**
 * Individual getter functions matching getConfig<EnvKey>() pattern.
 */
export const getConfigPort = (): number => env.PORT;
export const getConfigNodeEnv = (): 'development' | 'production' | 'test' => env.NODE_ENV;
export const getConfigLogLevel = (): string => env.LOG_LEVEL;
export const getConfigRedisHost = (): string => env.REDIS_HOST;
export const getConfigRedisPort = (): number => env.REDIS_PORT;
export const getConfigMongodbUri = (): string => env.MONGODB_URI;
export const getConfigAnthropicApiKey = (): string | undefined => env.ANTHROPIC_API_KEY;
export const getConfigOpenaiApiKey = (): string | undefined => env.OPENAI_API_KEY;
export const getConfigGithubToken = (): string | undefined => env.GITHUB_TOKEN;
export const getConfigGithubDefaultOwner = (): string | undefined => env.GITHUB_DEFAULT_OWNER;
export const getConfigWebhookSecret = (): string | undefined => env.WEBHOOK_SECRET;
export const getConfigSlackWebhookUrl = (): string | undefined => env.SLACK_WEBHOOK_URL;
export const getConfigSlackBotToken = (): string | undefined => env.SLACK_BOT_TOKEN;
export const getConfigAppName = (): string | undefined => env.APP_NAME;
