import { Queue, Worker, Job } from 'bullmq';
import { redisClient } from '@/queue/redis';
import { NormalizedIncident } from '@/ingestion/types';
import { orchestratorAgent } from '@/agent/orchestrator';
import { dbService } from '@/db/dbService';
import { sendSlackNotification } from '@/notifications/slackNotifier';
import { lockService } from '@/lock';
import { logger } from '@/utils/logger';
import { getConfigRedisLockDurationMs } from '@/config/env';

export const QUEUE_NAME = 'incident-queue';

export const alertQueue = new Queue<NormalizedIncident>(QUEUE_NAME, {
  connection: redisClient,
});

/**
 * Deduplication check using lockService.
 */
export async function isDuplicateAlert(incident: NormalizedIncident): Promise<boolean> {
  const lockKey = `dedup:${incident.serviceName}:${incident.errorClass}:${incident.version.resolvedRef}`;
  const acquired = await lockService.tryLock(lockKey, getConfigRedisLockDurationMs());
  
  if (!acquired) {
    logger.info(`[LockService] Lock already held for ${lockKey}. Incident is a duplicate.`);
    return true;
  }

  return false;
}

/**
 * Worker handler: Delegates job execution to OrchestratorAgent with lock audit monitoring.
 */
export const alertWorker = new Worker<NormalizedIncident>(
  QUEUE_NAME,
  async (job: Job<NormalizedIncident>) => {
    const incident = job.data;
    const lockKey = `job-lock:${incident.incidentId}`;

    await lockService.withLock(
      lockKey,
      async () => {
        const channelId = incident.metadata?.channelId;
        const threadTs = incident.metadata?.threadTs;
        const userPrompt = incident.metadata?.userPrompt;

        // Delegate to OrchestratorAgent (which manages Subagents & MongoDB persistence)
        const rcaSummary = await orchestratorAgent.handleIncident(incident, channelId, threadTs, userPrompt);

        // Fetch updated job from MongoDB to check if a PR was created
        const jobDoc = await dbService.getJobById(incident.incidentId);

        // Send Slack Notification only if the webhook originated from Slack
        if (incident.source === 'SLACK' || incident.metadata?.channelId) {
          await sendSlackNotification({
            incident,
            rcaSummary,
            prUrl: jobDoc?.prUrl,
          });
        } else {
          logger.info(`[AlertQueue] Incident source is ${incident.source} (not SLACK). Skipping Slack notification.`);
        }
      },
      { expirationMs: 300000 }
    );
  },
  { connection: redisClient }
);

alertWorker.on('completed', (job) => {
  logger.info(`[AlertQueue] Job ${job.id} completed successfully`);
});

alertWorker.on('failed', (job, err) => {
  logger.error(`[AlertQueue] Job ${job?.id} failed with error: ${err.message}`);
});

