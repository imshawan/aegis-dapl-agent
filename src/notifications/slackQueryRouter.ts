import { dbService } from '@/db/dbService';
import { orchestratorAgent } from '@/agent/orchestrator';
import { logger } from '@/utils/logger';

export interface MidJobQueryInput {
  channelId: string;
  threadTs: string;
  userQuestion: string;
}

/**
   * Routes an interactive mid-job question from a Slack thread to the active Orchestrator instance.
   * Resolves the master jobId from the Slack thread ID and invokes the orchestrator query handler.
   */
export async function handleMidJobSlackQuery(input: MidJobQueryInput): Promise<string> {
  logger.info(`[SlackQueryRouter] Resolving master job entity from thread ${input.threadTs}: "${input.userQuestion}"`);

  // 1. Look up parent Job in MongoDB from thread ID
  const job = await dbService.findJobByThreadTs(input.channelId, input.threadTs);

  if (!job) {
    logger.warn(`[SlackQueryRouter] No active investigation found for thread ${input.threadTs}`);
    return `[WARN] Could not find an active Aegis investigation for this Slack thread.`;
  }

  // 2. Invoke the required Orchestrator instance using master jobId
  logger.info(`[SlackQueryRouter] Invoking Orchestrator query handler for master entity ${job.jobId}`);
  const responseText = await orchestratorAgent.handleMidJobQuery(job.jobId, input.userQuestion);

  return responseText;
}
