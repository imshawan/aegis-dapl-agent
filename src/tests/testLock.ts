import { lockService } from '@/lock';
import { logger } from '@/utils/logger';

logger.info('======================================================');
logger.info('Aegis AI - Idiomatic TypeScript Lock Service Test');
logger.info('======================================================');

async function testLockSystem() {
  const lockKey = 'test-incident-lock:payment-service:TypeError';

  logger.info('[1] Testing withLock (First Execution - Should Acquire):');
  const acquiredResult = await lockService.withLock(
    lockKey,
    async () => {
      logger.info('    Running inside lock guard context...');
      return 'JOB_COMPLETED_SUCCESSFULLY';
    },
    { expirationMs: 5000 }
  );

  logger.info(`    Result: ${acquiredResult}`);

  logger.info('[2] Testing tryLock & Lock Ownership:');
  const locked = await lockService.tryLock('test-manual-key', 5000);
  logger.info(`    Acquired Manual Lock: ${locked}`);

  const isLocked = await lockService.isLocked('test-manual-key');
  logger.info(`    Is Locked in Redis: ${isLocked}`);

  const ttl = await lockService.getLockTTL('test-manual-key');
  logger.info(`    Remaining TTL: ${ttl} ms`);

  const unlocked = await lockService.releaseLock('test-manual-key');
  logger.info(`    Released Lock: ${unlocked}`);

  logger.info('======================================================');
  logger.info('Idiomatic TypeScript Lock Service Verification Complete');
  logger.info('======================================================');
  process.exit(0);
}

testLockSystem();


