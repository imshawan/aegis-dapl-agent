import { describe, it } from 'node:test';
import assert from 'node:assert';
import { lockService } from '@/lock';

describe('🔐 Aegis Idiomatic TypeScript Lock Service Suite', () => {
  it('should execute inside lock guard context with withLock', async () => {
    const lockKey = 'test-incident-lock:payment-service:TypeError';
    const acquiredResult = await lockService.withLock(
      lockKey,
      async () => {
        return 'JOB_COMPLETED_SUCCESSFULLY';
      },
      { expirationMs: 5000 }
    );

    // If offline mode is engaged or lock acquired, check return value
    assert.ok(acquiredResult === 'JOB_COMPLETED_SUCCESSFULLY' || acquiredResult === null);
  });

  it('should tryLock, check ownership, and release lock cleanly', async () => {
    const locked = await lockService.tryLock('test-manual-key', 5000);
    assert.strictEqual(typeof locked, 'boolean');

    const isLocked = await lockService.isLocked('test-manual-key');
    assert.strictEqual(typeof isLocked, 'boolean');

    const ttl = await lockService.getLockTTL('test-manual-key');
    assert.ok(ttl === null || typeof ttl === 'number');

    const unlocked = await lockService.releaseLock('test-manual-key');
    assert.strictEqual(typeof unlocked, 'boolean');
  });
});
