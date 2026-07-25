import { LFUMemoryStore } from '@/db/lfuMemoryStore';
import { logger } from '@/utils/logger';

async function verifyLFUEviction() {
  logger.info('======================================================');
  logger.info('Aegis - LFU Fan-Out Eviction Mechanism Test');
  logger.info('======================================================');

  // Create an LFUMemoryStore with max capacity = 5
  const evictedLogs: string[] = [];
  const store = new LFUMemoryStore<string>(5, (key, val) => {
    evictedLogs.push(`Evicted key: ${key} (${val})`);
  });

  logger.info('[1] Inserting 5 items (reaching maximum capacity)...');
  store.set('job-1', 'Incident 1');
  store.set('job-2', 'Incident 2');
  store.set('job-3', 'Incident 3');
  store.set('job-4', 'Incident 4');
  store.set('job-5', 'Incident 5');

  logger.info('[2] Simulating high traffic on job-2, job-3, job-4, and job-5...');
  // Access job-2, 3, 4, 5 multiple times so their accessCount increases
  store.get('job-2'); store.get('job-2');
  store.get('job-3'); store.get('job-3'); store.get('job-3');
  store.get('job-4');
  store.get('job-5');

  logger.info('[3] Current Diagnostics before inserting job-6:');
  console.table(store.getDiagnostics());

  logger.info('[4] Inserting job-6 (Exceeds capacity! Should fan-out evict least used key job-1)...');
  store.set('job-6', 'Incident 6');

  logger.info('[5] Current Diagnostics after eviction:');
  console.table(store.getDiagnostics());

  logger.info('[6] Fan-Out Eviction Callback Results:');
  evictedLogs.forEach((msg) => logger.info(`  -> ${msg}`));

  if (store.has('job-1') === false && store.has('job-6') === true) {
    logger.info('======================================================');
    logger.info('SUCCESS: LFU Fan-Out Eviction verified! Exponential growth prevented.');
    logger.info('======================================================');
  } else {
    logger.error('FAIL: Eviction did not behave as expected.');
    process.exit(1);
  }
}

verifyLFUEviction().catch((err) => {
  logger.error('Error in test:', err);
  process.exit(1);
});
