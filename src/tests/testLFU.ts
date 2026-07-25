import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LFUMemoryStore } from '@/db/lfuMemoryStore';
import logger from '@/utils/logger';

describe('🚀 Aegis LFU Fan-Out Eviction Mechanism Suite', () => {
  it('should evict least frequently used item when max capacity is exceeded', () => {
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

    assert.strictEqual(store.has('job-1'), false, 'job-1 should have been evicted');
    assert.strictEqual(store.has('job-6'), true, 'job-6 should be present');
    assert.strictEqual(evictedLogs.length, 1);
    assert.match(evictedLogs[0], /Evicted key: job-1/);
  });
});
