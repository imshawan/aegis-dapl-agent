import { dbService } from '@/db/dbService';
import { orchestratorAgent } from '@/agent/orchestrator';
import { logger } from '@/utils/logger';

export interface MidJobQueryInput {
  channelId: string;
  threadTs: string;
  userQuestion: string;
  overrideJobId?: string;
}

/**
 * Routes an interactive mid-job question or status check from a Slack thread/DM to the active Orchestrator instance.
 * Resolves the master jobId from overrideJobId or the Slack thread ID and invokes the orchestrator query handler.
 */
export async function handleMidJobSlackQuery(input: MidJobQueryInput): Promise<string> {
  let job: any = null;

  if (input.overrideJobId) {
    logger.info(`[SlackQueryRouter] Resolving master job directly by ID: ${input.overrideJobId}`);
    job = await dbService.getJobById(input.overrideJobId);
  } else {
    logger.info(`[SlackQueryRouter] Resolving master job entity from thread ${input.threadTs}: "${input.userQuestion}"`);
    job = await dbService.findJobByThreadTs(input.channelId, input.threadTs);
  }

  if (!job) {
    logger.warn(`[SlackQueryRouter] No active investigation found for query: "${input.userQuestion}"`);
    return `[WARN] Could not find an active Aegis investigation matching this Slack thread or Job ID.`;
  }

  logger.info(`[SlackQueryRouter] Invoking Orchestrator query handler for master entity ${job.jobId}`);
  const responseText = await orchestratorAgent.handleMidJobQuery(job.jobId, input.userQuestion);

  return responseText;
}
