import { dbService } from '@/db/dbService';
import { getLLMModel } from '@/agent/incidentAgent';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { logger } from '@/utils/logger';

export interface MidJobQueryInput {
  channelId: string;
  threadTs: string;
  userQuestion: string;
}

export async function handleMidJobSlackQuery(input: MidJobQueryInput): Promise<string> {
  logger.info(`[SlackQueryRouter] Processing mid-job query in thread ${input.threadTs}: "${input.userQuestion}"`);

  // 1. Look up parent Job in MongoDB
  const job = await dbService.findJobByThreadTs(input.channelId, input.threadTs);

  if (!job) {
    return `[WARN] Could not find an active Aegis AI investigation for this Slack thread.`;
  }

  // Record user query in MongoDB
  await dbService.addPromptMessage(job.jobId, 'user', input.userQuestion);

  // 2. Extract current Subagent Worker Tasks & Prompt History
  const activeTasks = job.workerTasks.map((t) => ({
    taskId: t.taskId,
    worker: t.workerType,
    status: t.status,
    resultSummary: t.outputResult ? t.outputResult.slice(0, 300) : 'Running...',
  }));

  // 3. Synthesize non-blocking response via LLM
  const llm = getLLMModel();
  let responseText = '';

  if (llm) {
    const prompt = `You are Aegis AI Assistant answering a mid-investigation question from an engineer in Slack.
Answer concisely based on the current subagent worker states without disrupting background execution.

Job Status: ${job.status}
Service: ${job.serviceName} (${job.errorClass})
Active Subagent Workers: ${JSON.stringify(activeTasks, null, 2)}
User Question: "${input.userQuestion}"`;

    const aiRes = await llm.invoke([
      new SystemMessage('You are Aegis AI Slack Assistant. Answer questions accurately based on worker logs.'),
      new HumanMessage(prompt),
    ]);
    responseText = typeof aiRes.content === 'string' ? aiRes.content : JSON.stringify(aiRes.content);
  } else {
    responseText = `**Aegis Status Update**\n- **Service:** \`${job.serviceName}\`\n- **Job Status:** \`${job.status}\`\n- **Subagents:** ${job.workerTasks.length} worker tasks recorded.\n\n*Background investigation is actively running.*`;
  }

  // Record Assistant reply in MongoDB
  await dbService.addPromptMessage(job.jobId, 'assistant', responseText, 'SlackQueryRouter');

  logger.info(`[SlackQueryRouter] Responded to mid-job query without interrupting background workers.`);
  return responseText;
}
