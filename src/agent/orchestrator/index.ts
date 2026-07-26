import { NormalizedIncident, VersionResolution } from '@/ingestion/types';
import { dbService } from '@/db/dbService';
import { JobModel, IJob } from '@/db/models/job';
import { CodeScoperWorker } from '@/agent/workers/codeScoperWorker';
import { GitDiffWorker } from '@/agent/workers/gitDiffWorker';
import { PatchWorker } from '@/agent/workers/patchWorker';
import { createRemediationPR, ProposedPatch } from '@/notifications/githubPR';
import { getLLMModel } from '@/agent/incidentAgent';
import { createOrchestratorTools } from './tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages';
import { logger } from '@/utils/logger';
import { getConfigLlmQueryTimeoutMs, getConfigNodeEnv } from '@/config/env';

export class OrchestratorAgent {
  private codeScoperWorker = new CodeScoperWorker();
  private gitDiffWorker = new GitDiffWorker();
  private patchWorker = new PatchWorker();

  /**
   * Main Orchestrator entrypoint: Manages incident investigation, spawning specialized worker subagents.
   * Every database write enforces jobId as its master relational entity.
   */
  async handleIncident(
    incident: NormalizedIncident,
    channelId?: string,
    threadTs?: string,
    userPrompt?: string
  ): Promise<string> {
    logger.info(`[Orchestrator] Managing incident investigation for master entity ${incident.incidentId}...`);

    // Check if job already exists in MongoDB (for resumption)
    let job = await dbService.getJobById(incident.incidentId);

    if (!job) {
      job = await dbService.createJob(incident, channelId, threadTs, userPrompt);
    } else if (job.status === 'COMPLETED' && job.rcaSummary) {
      logger.info(`[Orchestrator] Job ${incident.incidentId} is already COMPLETED. Returning existing RCA.`);
      return job.rcaSummary;
    }

    return this.resumeOrExecuteJob(job, incident);
  }

  /**
   * Resumes an interrupted job from MongoDB checkpointing, skipping already-completed worker subtasks.
   */
  async resumeJob(jobId: string): Promise<string> {
    logger.info(`[Orchestrator] Resuming interrupted job for master entity ${jobId}...`);
    const job = await dbService.getJobById(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found in MongoDB.`);
    }

    if (job.status === 'COMPLETED' && job.rcaSummary) {
      logger.info(`[Orchestrator] Job ${jobId} was already completed.`);
      return job.rcaSummary;
    }

    // Reconstruct NormalizedIncident stub from DB document
    const incident: NormalizedIncident = {
      incidentId: job.jobId,
      source: 'GENERIC',
      serviceName: job.serviceName,
      environment: job.environment,
      errorClass: job.errorClass,
      errorMessage: job.errorMessage,
      timestamp: job.createdAt.toISOString(),
      version: {
        resolvedRef: job.version.resolvedRef,
        resolutionSource: (job.version.resolutionSource as VersionResolution['resolutionSource']) || 'DEFAULT_BRANCH',
      },
      stackTrace: [],
    };

    return this.resumeOrExecuteJob(job, incident);
  }

  /**
   * Handles interactive mid-job queries from Slack by resolving the master jobId
   * and interrogating the active Orchestrator job state without pausing loop execution.
   */
  async handleMidJobQuery(jobId: string, userQuestion: string): Promise<string> {
    logger.info(`[Orchestrator] Interrogating active job state for master entity ${jobId}: "${userQuestion}"`);
    const job = await dbService.getJobById(jobId);
    if (!job) {
      return `[WARN] Could not find an active Aegis investigation for job ID: ${jobId}`;
    }

    // Record user query in MongoDB with jobId as master relational entity
    await dbService.addPromptMessage(job.jobId, 'user', userQuestion);

    // Extract current subagent worker tasks & prompt reasoning history
    const activeTasks = job.workerTasks.map((t) => ({
      taskId: t.taskId,
      worker: t.workerType,
      status: t.status,
      resultSummary: typeof t.outputResult === 'string' ? t.outputResult.slice(0, 300) : JSON.stringify(t.outputResult || 'Running...'),
    }));

    const recentReasoning = job.promptMessages.slice(-5).map((m) => `[${m.role}] ${(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).slice(0, 200)}`);

    const llm = getLLMModel();
    let responseText = '';

    if (llm) {
      try {
        const prompt = `You are Aegis Assistant answering a mid-investigation question or status check from an engineer in Slack.
Answer concisely based on the current Orchestrator loop state and worker tasks without disrupting background execution.

Master Job ID: ${job.jobId}
Job Status: ${job.status}
Service: ${job.serviceName} (${job.errorClass})
Error Message: ${job.errorMessage}
Pull Request: ${job.prUrl || 'Not generated yet'}
Active Subagent Workers: ${JSON.stringify(activeTasks, null, 2)}
Recent Orchestrator Reasoning: ${JSON.stringify(recentReasoning, null, 2)}
User Question: "${userQuestion}"`;

        const timeoutMs = getConfigNodeEnv() === 'test' ? 3000 : getConfigLlmQueryTimeoutMs();
        const aiRes = await Promise.race([
          llm.invoke([
            new SystemMessage('You are Aegis Slack Assistant. Answer questions accurately based on real-time Orchestrator memory and worker logs.'),
            new HumanMessage(prompt),
          ]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('LLM query timeout')), timeoutMs))
        ]) as any;
        responseText = typeof aiRes.content === 'string' ? aiRes.content : JSON.stringify(aiRes.content);
      } catch (err: any) {
        logger.warn(`[Orchestrator] LLM query failed or timed out (${err.message || err}). Using offline status fallback.`);
        responseText = `**Aegis Orchestrator Status Update**\n• *Master Job ID*: \`${job.jobId}\`\n• *Service*: \`${job.serviceName}\`\n• *Status*: \`${job.status}\`\n• *Error*: \`${job.errorClass}\`\n• *Pull Request*: ${job.prUrl ? `${job.prUrl}` : 'Not generated yet'}\n• *Subagent Tools Executed*: ${job.workerTasks.length} tasks recorded.\n\n*Background investigation loop is actively processing.*`;
      }
    } else {
      responseText = `**Aegis Orchestrator Status Update**\n• *Master Job ID*: \`${job.jobId}\`\n• *Service*: \`${job.serviceName}\`\n• *Status*: \`${job.status}\`\n• *Error*: \`${job.errorClass}\`\n• *Pull Request*: ${job.prUrl ? `${job.prUrl}` : 'Not generated yet'}\n• *Subagent Tools Executed*: ${job.workerTasks.length} tasks recorded.\n\n*Background investigation loop is actively processing.*`;
    }

    // Record Assistant reply in MongoDB with jobId as master relational entity
    await dbService.addPromptMessage(job.jobId, 'assistant', responseText, 'OrchestratorQueryHandler');

    logger.info(`[Orchestrator] Responded to mid-job query for master entity ${job.jobId}.`);
    return responseText;
  }

  /**
   * Internal execution handler: Chooses between the autonomous ReAct tool-calling loop (if LLM present)
   * or defensive heuristic fallback (for CI/CD and local simulation without API keys).
   */
  private async resumeOrExecuteJob(job: IJob, incident: NormalizedIncident): Promise<string> {
    await dbService.updateJobStatus(job.jobId, 'IN_PROGRESS');
    const llm = getLLMModel();

    if (llm) {
      logger.info(`[Orchestrator] Launching autonomous LLM tool-calling ReAct loop for job ${job.jobId}...`);
      return this.executeReActLoop(job, incident, llm);
    } else {
      logger.info(`[Orchestrator] No LLM API keys detected. Launching defensive heuristic fallback for job ${job.jobId}...`);
      return this.executeHeuristicFallback(job, incident);
    }
  }

  /**
   * True Agentic Orchestrator (Dynamic LLM-Driven ReAct Loop):
   * Exposes subagents as LangChain tools, evaluates observations in a loop, and checkpoints state to MongoDB.
   */
  private async executeReActLoop(job: IJob, incident: NormalizedIncident, llm: any): Promise<string> {
    const jobId = job.jobId; // Master relational entity

    // 1. Initialize Worker Tools with MongoDB checkpointing
    const { toolsMap, toolsList } = createOrchestratorTools({
      jobId,
      job,
      incident,
      codeScoperWorker: this.codeScoperWorker,
      gitDiffWorker: this.gitDiffWorker,
      patchWorker: this.patchWorker,
    });

    const llmWithTools = llm.bindTools(toolsList);

    // 2. Initialize conversation history with Lead Investigation System Prompt
    const systemPrompt = `You are Aegis, the Lead SRE Incident Investigation Orchestrator managing master job ${jobId}.
Your objective is to investigate the production incident, identify the root cause, and generate a defensive code patch.
CRITICAL MANDATE: In Turn 1, you MUST invoke the tool 'spawn_code_scoper_worker' to inspect the AST and source code around the target error line. Do NOT attempt to guess the root cause or write a final report without calling tools first!
In subsequent turns, you MUST invoke 'spawn_git_diff_worker' and 'spawn_patch_worker' to gather evidence and generate fixes.
Only AFTER you have executed all worker tools and received their observations should you output your final markdown Root Cause Analysis (RCA) report.`;

    const initialHumanPrompt = `Incident: ${incident.errorClass} - ${incident.errorMessage}
Service: ${incident.serviceName} (${incident.version.resolvedRef})
Top Stack Frame: ${JSON.stringify(incident.stackTrace[0] || {})}`;

    await dbService.addPromptMessage(jobId, 'orchestrator', `Initializing ReAct loop for incident: ${incident.errorClass}`, 'OrchestratorAgent');

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(initialHumanPrompt),
    ];

    let rcaMarkdown = '';

    // 3. ReAct Autonomous Loop (Max 10 iterations)
    for (let turn = 0; turn < 10; turn++) {
      logger.info(`[OrchestratorLoop] Turn ${turn + 1}: Invoking LLM planner...`);
      const aiMessage = await llmWithTools.invoke(messages);
      messages.push(aiMessage);

      if (aiMessage.content) {
        const textContent = typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content);
        logger.info(`[OrchestratorLoop] AI response content (Turn ${turn + 1}): ${textContent.slice(0, 300)}...`);
        await dbService.addPromptMessage(jobId, 'orchestrator', `[Turn ${turn + 1}] ${textContent}`, 'OrchestratorAgent');
      }

      // Fallback parser for local Ollama / non-OpenAI models that output JSON tool calls in text content
      let toolCallsToExecute = aiMessage.tool_calls ? [...aiMessage.tool_calls] : [];
      if (toolCallsToExecute.length === 0 && aiMessage.content && typeof aiMessage.content === 'string') {
        const validToolNames = Object.keys(toolsMap);
        const extractedJsonObjects: any[] = [];
        
        // Try direct JSON parse first (when the entire response is a JSON object or array)
        try {
          const direct = JSON.parse(aiMessage.content.trim());
          if (Array.isArray(direct)) extractedJsonObjects.push(...direct);
          else if (typeof direct === 'object' && direct !== null) extractedJsonObjects.push(direct);
        } catch {}

        // If direct parse didn't yield valid tool objects, scan string with brace counting
        if (extractedJsonObjects.length === 0) {
          let startIndex = -1;
          let braceCount = 0;
          let inString = false;
          let escapeNext = false;
          for (let i = 0; i < aiMessage.content.length; i++) {
            const char = aiMessage.content[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (!inString) {
              if (char === '{') {
                if (braceCount === 0) startIndex = i;
                braceCount++;
              } else if (char === '}') {
                braceCount--;
                if (braceCount === 0 && startIndex !== -1) {
                  try {
                    const parsed = JSON.parse(aiMessage.content.slice(startIndex, i + 1));
                    if (typeof parsed === 'object' && parsed !== null) extractedJsonObjects.push(parsed);
                  } catch {}
                  startIndex = -1;
                }
              }
            }
          }
        }

        for (const parsed of extractedJsonObjects) {
          const name = parsed.name || parsed.tool || parsed.function;
          const args = parsed.arguments || parsed.args || parsed.parameters || {};
          if (name && validToolNames.includes(name)) {
            toolCallsToExecute.push({
              name,
              args: typeof args === 'string' ? JSON.parse(args) : args,
              id: `fallback_call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            });
          }
        }

        if (toolCallsToExecute.length > 0) {
          logger.info(`[OrchestratorLoop] Extracted ${toolCallsToExecute.length} fallback JSON tool call(s) from Ollama text response!`);
          aiMessage.tool_calls = toolCallsToExecute;
        }
      }

      // Check if LLM requested subagent tool calls
      if (toolCallsToExecute.length === 0) {
        logger.info(`[OrchestratorLoop] Loop completed. Final RCA synthesized by LLM.`);
        rcaMarkdown = typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content);
        break;
      }

      // Execute requested subagent tools
      for (const toolCall of toolCallsToExecute) {
        logger.info(`[OrchestratorLoop] Executing tool: ${toolCall.name}`);
        const targetTool = toolsMap[toolCall.name];
        let observation = '';
        if (targetTool) {
          observation = await targetTool.invoke(toolCall.args);
        } else {
          observation = `Error: Tool ${toolCall.name} not found.`;
        }

        await dbService.addPromptMessage(jobId, 'worker', `Tool Observation [${toolCall.name}]: ${observation.slice(0, 500)}`, 'ToolExecutor');
        messages.push(new ToolMessage({ content: observation, tool_call_id: toolCall.id || `call_${Date.now()}` }));
      }
    }

    if (!rcaMarkdown) {
      rcaMarkdown = `# Aegis RCA Report - ${incident.serviceName}\n\n*ReAct loop terminated after max iterations.*`;
    }

    // 4. Create Draft Pull Request if patches exist in DB checkpoint
    let prUrl: string | undefined;
    const updatedJob = await dbService.getJobById(jobId);
    const patchTask = updatedJob?.workerTasks.find((t) => t.workerType === PatchWorker.workerType);
    if (patchTask && patchTask.status === 'COMPLETED' && patchTask.outputResult) {
      try {
        const proposedPatches: ProposedPatch[] = JSON.parse(patchTask.outputResult);
        if (proposedPatches.length > 0 && incident.repository?.owner && incident.repository?.repo) {
          const prResult = await createRemediationPR(
            incident.repository.owner,
            incident.repository.repo,
            incident,
            rcaMarkdown,
            proposedPatches
          );
          if (prResult) {
            prUrl = prResult.prUrl;
          }
        }
      } catch (err: any) {
        logger.error(`[Orchestrator] Error parsing patch output for PR creation: ${err.message}`);
      }
    }

    // Record final RCA & mark master entity COMPLETED in MongoDB
    await dbService.addPromptMessage(jobId, 'orchestrator', rcaMarkdown, 'OrchestratorAgent');
    await dbService.updateJobStatus(jobId, 'COMPLETED', rcaMarkdown, prUrl);

    logger.info(`[Orchestrator] ReAct loop completed for master entity ${jobId}.`);
    return rcaMarkdown;
  }

  /**
   * Defensive Heuristic Fallback (When no LLM API keys are configured):
   * Sequentially executes CodeScoper, GitDiff, and PatchWorker to ensure 100% reliable local test execution.
   */
  private async executeHeuristicFallback(job: IJob, incident: NormalizedIncident): Promise<string> {
    const jobId = job.jobId; // Master relational entity

    // Task 1 Checkpoint: CodeScoperWorker
    let scopedSnippets: any[] = [];
    const task1 = job.workerTasks.find((t) => t.workerType === CodeScoperWorker.workerType);
    if (task1 && task1.status === 'COMPLETED' && task1.outputResult) {
      logger.info(`[Orchestrator] Reusing COMPLETED task ${task1.taskId} output from MongoDB.`);
      try { scopedSnippets = JSON.parse(task1.outputResult); } catch { scopedSnippets = []; }
    } else {
      const taskId1 = task1?.taskId || `task_scope_${Date.now()}`;
      if (!task1) {
        await dbService.addWorkerTask(jobId, taskId1, CodeScoperWorker.workerType, `Scope code frames for ${incident.serviceName}`);
      }
      try {
        scopedSnippets = await this.codeScoperWorker.runTask({ incident });
        await dbService.updateWorkerTaskResult(jobId, taskId1, 'COMPLETED', JSON.stringify(scopedSnippets));
      } catch (err: any) {
        await dbService.updateWorkerTaskResult(jobId, taskId1, 'FAILED', err.message);
        await dbService.updateJobStatus(jobId, 'FAILED');
        throw err;
      }
    }

    // Task 2 Checkpoint: GitDiffWorker
    let gitHistoryResult = 'No git history fetched.';
    if (scopedSnippets.length > 0) {
      const task2 = job.workerTasks.find((t) => t.workerType === GitDiffWorker.workerType);
      if (task2 && task2.status === 'COMPLETED' && task2.outputResult) {
        logger.info(`[Orchestrator] Reusing COMPLETED task ${task2.taskId} output from MongoDB.`);
        gitHistoryResult = task2.outputResult;
      } else {
        const taskId2 = task2?.taskId || `task_git_${Date.now()}`;
        const targetFile = scopedSnippets[0].filePath;
        if (!task2) {
          await dbService.addWorkerTask(jobId, taskId2, GitDiffWorker.workerType, `Fetch recent commits for ${targetFile}`);
        }
        try {
          gitHistoryResult = await this.gitDiffWorker.runTask({
            repo: incident.repository?.repo || incident.serviceName,
            filePath: targetFile,
          });
          await dbService.updateWorkerTaskResult(jobId, taskId2, 'COMPLETED', gitHistoryResult);
        } catch (err: any) {
          await dbService.updateWorkerTaskResult(jobId, taskId2, 'FAILED', err.message);
        }
      }
    }

    // Task 3 Checkpoint: PatchWorker
    let proposedPatches: ProposedPatch[] = [];
    if (scopedSnippets.length > 0) {
      const task3 = job.workerTasks.find((t) => t.workerType === PatchWorker.workerType);
      if (task3 && task3.status === 'COMPLETED' && task3.outputResult) {
        logger.info(`[Orchestrator] Reusing COMPLETED task ${task3.taskId} output from MongoDB.`);
        try { proposedPatches = JSON.parse(task3.outputResult); } catch { proposedPatches = []; }
      } else {
        const taskId3 = task3?.taskId || `task_patch_${Date.now()}`;
        if (!task3) {
          await dbService.addWorkerTask(jobId, taskId3, PatchWorker.workerType, `Generate remediation patch for ${scopedSnippets[0].filePath}`);
        }
        try {
          proposedPatches = await this.patchWorker.runTask({ incident, scopedSnippets, gitHistoryResult });
          await dbService.updateWorkerTaskResult(jobId, taskId3, 'COMPLETED', JSON.stringify(proposedPatches, null, 2));
        } catch (err: any) {
          await dbService.updateWorkerTaskResult(jobId, taskId3, 'FAILED', err.message);
        }
      }
    }

    const rcaMarkdown = `# Aegis RCA Report - ${incident.serviceName}\n\n**Error:** \`${incident.errorClass}: ${incident.errorMessage}\`\n**Ref:** \`${incident.version.resolvedRef}\`\n**Target File:** \`${scopedSnippets[0]?.filePath || 'N/A'}\`\n\n*${proposedPatches.length > 0 ? 'Code scoped and remediation patches generated successfully by Aegis Subagents.' : 'Incident localized and diagnostic context gathered by Aegis Subagents. No code modifications attempted without AI reasoning (No LLM API keys configured).*'}`;

    // Create Draft Pull Request if patches exist
    let prUrl: string | undefined;
    if (proposedPatches.length > 0 && incident.repository?.owner && incident.repository?.repo) {
      const prResult = await createRemediationPR(
        incident.repository.owner,
        incident.repository.repo,
        incident,
        rcaMarkdown,
        proposedPatches
      );
      if (prResult) { prUrl = prResult.prUrl; }
    }

    await dbService.addPromptMessage(jobId, 'orchestrator', rcaMarkdown, 'OrchestratorAgent');
    await dbService.updateJobStatus(jobId, 'COMPLETED', rcaMarkdown, prUrl);

    logger.info(`[Orchestrator] Heuristic fallback completed for master entity ${jobId}.`);
    return rcaMarkdown;
  }
}

export const orchestratorAgent = new OrchestratorAgent();
