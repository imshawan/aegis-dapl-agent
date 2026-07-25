export type LockAuditStatus = 'ACQUIRED' | 'RELEASED' | 'SKIPPED' | 'ERROR';
export type LockAuditResult = 'SUCCESS' | 'ERROR' | 'SKIPPED';

export interface LockAuditRecord {
  id?: string;
  lockKey: string;
  acquiredAt?: Date;
  releasedAt?: Date;
  acquiredBy: string;
  status: LockAuditStatus;
  result: LockAuditResult;
  waitTimeSeconds: number;
  expirationSeconds: number;
  durationMs?: number;
  errorMessage?: string;
}

export interface LockOptions {
  waitTimeMs?: number;
  expirationMs?: number;
}

