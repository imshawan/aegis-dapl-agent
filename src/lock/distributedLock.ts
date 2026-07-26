import os from 'os';
import { redisClient } from '@/queue/redis';
import { lockAudit } from '@/lock/auditService';
import { LockAuditRecord, LockOptions } from '@/lock/types';
import { logger } from '@/utils/logger';
import { getConfigAppName, getConfigRedisLockDurationMs } from '@/config/env';
import pkg from 'package.json';

const DEFAULT_WAIT_TIME_MS = 0;
const getDefaultLockExpirationMs = () => getConfigRedisLockDurationMs();

const appName = getConfigAppName() || pkg.name;
const hostname = os.hostname() || 'unknown';
const ownerId = `${appName}:${hostname}:${process.pid}:${Math.random().toString(36).slice(2, 7)}`;

const getServiceIdentifier = () => `${appName}:${hostname}`;

logger.info(`[LockService] Initialized lock service for identifier: ${getServiceIdentifier()}`);

/**
 * Attempts to acquire an atomic lock in Redis with specified expiration time.
 */
export async function tryLock(lockKey: string, expirationMs: number = getDefaultLockExpirationMs()): Promise<boolean> {
  if (redisClient.status === 'end' || redisClient.status === 'close' || redisClient.status === 'reconnecting') {
    return true; // Offline mode bypass
  }
  try {
    const result = await redisClient.set(lockKey, ownerId, 'PX', expirationMs, 'NX');
    return result === 'OK';
  } catch (error: any) {
    if (error?.message?.includes('closed') || error?.message?.includes('Connection') || error?.message?.includes('connect') || error?.code === 'EPERM' || error?.code === 'ECONNREFUSED') {
      return true; // Offline mode bypass
    }
    logger.error(`[LockService] Error acquiring lock for key ${lockKey}: ${error.message}`);
    return false;
  }
}

/**
 * Safely releases lock using an atomic Lua script to ensure only the lock owner can release it.
 */
export async function releaseLock(lockKey: string): Promise<boolean> {
  if (redisClient.status === 'end' || redisClient.status === 'close' || redisClient.status === 'reconnecting') {
    return true; // Offline mode bypass
  }
  const luaScript = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;

  try {
    const result = await redisClient.eval(luaScript, 1, lockKey, ownerId);
    return result === 1;
  } catch (error: any) {
    if (error?.message?.includes('closed') || error?.message?.includes('Connection') || error?.message?.includes('connect') || error?.code === 'EPERM' || error?.code === 'ECONNREFUSED') {
      return true; // Offline mode bypass
    }
    logger.error(`[LockService] Error releasing lock for key ${lockKey}: ${error.message}`);
    return false;
  }
}

export async function isLocked(lockKey: string): Promise<boolean> {
  try {
    const exists = await redisClient.exists(lockKey);
    return exists === 1;
  } catch {
    return false;
  }
}

export async function getLockTTL(lockKey: string): Promise<number | null> {
  try {
    const ttl = await redisClient.pttl(lockKey);
    return ttl > 0 ? ttl : null;
  } catch {
    return null;
  }
}

/**
 * Idiomatic TypeScript wrapper: Executes an async action ONLY if lock is acquired, handling audit logging and cleanup.
 */
export async function withLock<T>(
  lockKey: string,
  action: () => Promise<T>,
  options: LockOptions = {}
): Promise<T | null> {
  const waitTimeMs = options.waitTimeMs ?? DEFAULT_WAIT_TIME_MS;
  const expirationMs = options.expirationMs ?? getDefaultLockExpirationMs();

  let auditId: string | null = null;
  let acquiredAt: Date | null = null;
  let lockAcquired = false;
  let resultStatus: 'SUCCESS' | 'ERROR' | 'SKIPPED' = 'SKIPPED';
  let errorMessage: string | undefined = undefined;

  try {
    lockAcquired = await tryLock(lockKey, expirationMs);

    if (lockAcquired) {
      acquiredAt = new Date();
      auditId = await createAuditRecord(lockKey, acquiredAt, waitTimeMs, expirationMs);

      try {
        const result = await action();
        resultStatus = 'SUCCESS';
        logger.info(`[LockAction] Action completed successfully for lock: ${lockKey}`);
        return result;
      } catch (e: any) {
        resultStatus = 'ERROR';
        errorMessage = e.message;
        logger.error(`[LockAction] Error executing action for lock: ${lockKey} - ${e.message}`);
        throw e;
      }
    } else {
      logger.info(`[LockAction] Lock not acquired (held by another process or deduplicated): ${lockKey}`);
      await createSkippedAudit(lockKey, waitTimeMs, expirationMs);
      return null;
    }
  } finally {
    if (lockAcquired) {
      try {
        await releaseLock(lockKey);
        const releasedAt = new Date();

        if (auditId && acquiredAt) {
          await updateAuditRecord(auditId, releasedAt, acquiredAt, resultStatus, errorMessage);
        }
      } catch (e: any) {
        logger.error(`[LockService] Error releasing lock in finally block: ${lockKey} - ${e.message}`);
      }
    }
  }
}

async function createAuditRecord(
  lockKey: string,
  acquiredAt: Date,
  waitTimeMs: number,
  expirationMs: number
): Promise<string | null> {
  try {
    const audit: LockAuditRecord = {
      lockKey,
      acquiredAt,
      acquiredBy: getServiceIdentifier(),
      status: 'ACQUIRED',
      result: 'SUCCESS',
      waitTimeSeconds: Math.round(waitTimeMs / 1000),
      expirationSeconds: Math.round(expirationMs / 1000),
    };

    const saved = await lockAudit.create(audit);
    return saved.id || null;
  } catch (e: any) {
    logger.error(`[LockService] CRITICAL: Failed to create audit record for lock: ${lockKey} - ${e.message}`);
    return null;
  }
}

async function createSkippedAudit(lockKey: string, waitTimeMs: number, expirationMs: number): Promise<void> {
  try {
    const audit: LockAuditRecord = {
      lockKey,
      acquiredBy: getServiceIdentifier(),
      status: 'SKIPPED',
      result: 'SKIPPED',
      waitTimeSeconds: Math.round(waitTimeMs / 1000),
      expirationSeconds: Math.round(expirationMs / 1000),
    };

    await lockAudit.create(audit);
  } catch (e: any) {
    logger.error(`[LockService] CRITICAL: Failed to create skipped audit record for lock: ${lockKey} - ${e.message}`);
  }
}

async function updateAuditRecord(
  auditId: string,
  releasedAt: Date,
  acquiredAt: Date,
  result: 'SUCCESS' | 'ERROR' | 'SKIPPED',
  errorMessage?: string
): Promise<void> {
  try {
    const existing = await lockAudit.findById(auditId);
    if (!existing) return;

    const durationMs = releasedAt.getTime() - acquiredAt.getTime();
    const updated: LockAuditRecord = {
      ...existing,
      releasedAt,
      durationMs,
      status: 'RELEASED',
      result,
      errorMessage,
    };

    await lockAudit.update(updated);
  } catch (e: any) {
    logger.error(`[LockService] CRITICAL: Failed to update audit record: id=${auditId} - ${e.message}`);
  }
}

export const lockService = {
  tryLock,
  releaseLock,
  isLocked,
  getLockTTL,
  withLock,
  unlock: releaseLock,
};

export const distributedLockService = lockService;

