import { LockAuditRecord } from '@/lock/types';
import { redisClient } from '@/queue/redis';
import { logger } from '@/utils/logger';

const AUDIT_PREFIX = 'audit:lock:';
const AUDIT_TTL_SECONDS = 86400; // 24-hour TTL

/**
 * Synchronously creates an audit record for debugging and monitoring.
 */
export async function createAuditRecord(audit: LockAuditRecord): Promise<LockAuditRecord> {
  const id = audit.id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record: LockAuditRecord = {
    ...audit,
    id,
    acquiredAt: audit.acquiredAt || new Date(),
  };

  try {
    const key = `${AUDIT_PREFIX}${id}`;
    await redisClient.set(key, JSON.stringify(record), 'EX', AUDIT_TTL_SECONDS);
    logger.info(`[LockAudit] Created record id=${id}, lockKey=${audit.lockKey}, status=${audit.status}`);
    return record;
  } catch (error: any) {
    logger.error(`[LockAudit] Failed to create audit record for lock: ${audit.lockKey} - ${error.message}`);
    return record;
  }
}

/**
 * Updates an existing audit record with release info and duration.
 */
export async function updateAuditRecord(audit: LockAuditRecord): Promise<void> {
  if (!audit.id) return;
  try {
    const key = `${AUDIT_PREFIX}${audit.id}`;
    await redisClient.set(key, JSON.stringify(audit), 'EX', AUDIT_TTL_SECONDS);
    logger.info(`[LockAudit] Updated record id=${audit.id}, duration=${audit.durationMs}ms, result=${audit.result}`);
  } catch (error: any) {
    logger.error(`[LockAudit] Failed to update audit record: id=${audit.id} - ${error.message}`);
  }
}

export async function findAuditRecordById(id: string): Promise<LockAuditRecord | null> {
  try {
    const key = `${AUDIT_PREFIX}${id}`;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export const lockAudit = {
  create: createAuditRecord,
  update: updateAuditRecord,
  findById: findAuditRecordById,
};

