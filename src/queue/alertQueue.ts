import { Queue, Worker, Job } from 'bullmq';
import { redisClient } from '@/queue/redis';
import { NormalizedIncident } from '@/ingestion/types';
import { createIncidentAgentGraph } from '@/agent/incidentAgent';
import { sendSlackNotification } from '@/notifications/slackNotifier';

export const QUEUE_NAME = 'incident-queue';

export const alertQueue = new Queue<NormalizedIncident>(QUEUE_NAME, {
  connection: redisClient,
});

/**
 * Deduplication helper: checks if an alert for the same service + errorClass + ref was received in the last 10 minutes.
 */
export async function isDuplicateAlert(incident: NormalizedIncident): Promise<boolean> {
  const dedupKey = `dedup:${incident.serviceName}:${incident.errorClass}:${incident.version.resolvedRef}`;
  const exists = await redisClient.get(dedupKey);
  
  if (exists) {
    return true; // Duplicate alert inside 10-min window
  }

  // Set 10-minute sliding window lock (600 seconds)
  await redisClient.set(dedupKey, '1', 'EX', 600);
  return false;
}

/**
 * Worker handler: Runs Aegis AI debugging loop, context scoper, and notification pipeline.
 */
export const alertWorker = new Worker<NormalizedIncident>(
  QUEUE_NAME,
  async (job: Job<NormalizedIncident>) => {
    const incident = job.data;
    console.log(`\n======================================================`);
    console.log(`🛡️ [Aegis AI] Starting Incident Debugging Workflow`);
    console.log(`======================================================`);
    console.log(`   Incident ID : ${incident.incidentId}`);
    console.log(`   Service     : ${incident.serviceName} (${incident.environment})`);
    console.log(`   Error       : ${incident.errorClass} - ${incident.errorMessage}`);
    console.log(`   Version Ref : ${incident.version.resolvedRef} [Source: ${incident.version.resolutionSource}]`);
    console.log(`   Stack Frames: ${incident.stackTrace.length} frames`);

    // 1. Initialize LangGraph.js Agent Graph
    const graph = createIncidentAgentGraph();

    // 2. Execute Aegis Agent Reasoning & Scoping Nodes
    const finalState = await graph.invoke({
      incident,
      scopedSnippets: [],
      messages: [],
      hypotheses: [],
      rcaReport: null,
      iterationCount: 0,
    });

    console.log(`\n📋 [Aegis AI] Scoped ${finalState.scopedSnippets.length} relevant code file snippets.`);

    // 3. Draft RCA Summary
    const rcaSummary = `### Root Cause Analysis Summary
- **Service:** ${incident.serviceName}
- **Error Class:** ${incident.errorClass}
- **Error Message:** ${incident.errorMessage}
- **Code Version:** ${incident.version.resolvedRef} (${incident.version.resolutionSource})
- **Primary Scoped File:** ${finalState.scopedSnippets[0]?.filePath || 'N/A'} (Line ${finalState.scopedSnippets[0]?.targetLineNumber || 'N/A'})

*Aegis AI has identified the error line in the scoped commit context and queued it for human review.*`;

    // 4. Send Slack Notification
    await sendSlackNotification({
      incident,
      rcaSummary,
    });

    console.log(`======================================================`);
    console.log(`✅ [Aegis AI] Completed incident workflow for ${incident.incidentId}`);
    console.log(`======================================================\n`);
  },
  { connection: redisClient }
);

alertWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

alertWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed with error: ${err.message}`);
});
