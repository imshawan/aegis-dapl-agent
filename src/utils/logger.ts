import winston from 'winston';
import 'winston-daily-rotate-file';
import { getConfigLogLevel, getConfigNodeEnv, getConfigLogRetentionDays } from '@/config/env';
import pkg from 'package.json';

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

// Custom console log format for human readability during development
const consoleFormat = printf(({ level, message, timestamp, stack, service, ...metadata }) => {
  let log = `${timestamp} [${level}]: ${stack || message}`;
  if (Object.keys(metadata).length > 0) {
    log += ` ${JSON.stringify(metadata)}`;
  }
  return log;
});

const retentionDays = getConfigLogRetentionDays();

export const logger = winston.createLogger({
  level: getConfigLogLevel() || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    getConfigNodeEnv() === 'production' ? json() : combine(colorize(), consoleFormat)
  ),
  defaultMeta: { service: pkg.name },
  transports: [
    new winston.transports.Console(),
    ...(getConfigNodeEnv() !== 'test'
      ? [
          new winston.transports.DailyRotateFile({
            filename: 'logs/error-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            level: 'error',
            maxFiles: retentionDays,
            zippedArchive: true,
          }),
          new winston.transports.DailyRotateFile({
            filename: 'logs/combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: retentionDays,
            zippedArchive: true,
          }),
        ]
      : []),
  ],
});

export default logger;
