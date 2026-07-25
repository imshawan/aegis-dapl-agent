import { NormalizedIncident, VersionResolution } from '@/ingestion/types';
import { dbService } from '@/db/dbService';
import { JobModel, IJob } from '@/db/models/job';
import { CodeScoperWorker } from '@/agent/workers/codeScoperWorker';
import { GitDiffWorker } from '@/agent/workers/gitDiffWorker';
import { getLLMModel } from '@/agent/incidentAgent';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { logger } from '@/utils/logger';

export class OrchestratorAgent {
  private codeScoperWorker = new CodeScoperWorker();
  private gitDiffWorker = new GitDiffWorker();

  /**
   * Main Orchestrator entrypoint: Manages incident investigation, spawning specialized worker subagents.
   */
  async handleIncident(
    incident: NormalizedIncident,
    channelId?: string,
    threadTs?: string,
    userPrompt?: string
  ): Promise<string> {
    logger.info(`[Orchestrator] Managing incident investigation for ${incident.incidentId}...`);

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
    logger.info(`[Orchestrator] Resuming interrupted job ${jobId}...`);
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
   * Internal execution pipeline that checks task completion checkpoints before executing workers.
   */
  private async resumeOrExecuteJob(job: IJob, incident: NormalizedIncident): Promise<string> {
    await dbService.updateJobStatus(job.jobId, 'IN_PROGRESS');

    // -------------------------------------------------------------
    // Task 1 Checkpoint: CodeScoperWorker
    // -------------------------------------------------------------
    let scopedSnippets: any[] = [];
    const task1 = job.workerTasks.find((t) => t.workerType === CodeScoperWorker.workerType);

    if (task1 && task1.status === 'COMPLETED' && task1.outputResult) {
      logger.info(`[Orchestrator] Reusing COMPLETED task ${task1.taskId} output from MongoDB.`);
      try {
        scopedSnippets = JSON.parse(task1.outputResult);
      } catch {
        scopedSnippets = [];
      }
    } else {
      const taskId1 = task1?.taskId || `task_scope_${Date.now()}`;
      if (!task1) {
        await dbService.addWorkerTask(
          job.jobId,
          taskId1,
          CodeScoperWorker.workerType,
          `Scope code frames for ${incident.serviceName}`
        );
      }

      try {
        scopedSnippets = await this.codeScoperWorker.runTask({ incident });
        await dbService.updateWorkerTaskResult(
          job.jobId,
          taskId1,
          'COMPLETED',
          JSON.stringify(scopedSnippets)
        );
      } catch (err: any) {
        await dbService.updateWorkerTaskResult(job.jobId, taskId1, 'FAILED', err.message);
        await dbService.updateJobStatus(job.jobId, 'FAILED');
        throw err;
      }
    }

    // -------------------------------------------------------------
    // Task 2 Checkpoint: GitDiffWorker
    // -------------------------------------------------------------
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
          await dbService.addWorkerTask(
            job.jobId,
            taskId2,
            GitDiffWorker.workerType,
            `Fetch recent commits for ${targetFile}`
          );
        }

        try {
          gitHistoryResult = await this.gitDiffWorker.runTask({
            repo: incident.repository?.repo || incident.serviceName,
            filePath: targetFile,
          });

          await dbService.updateWorkerTaskResult(
            job.jobId,
            taskId2,
            'COMPLETED',
            gitHistoryResult
          );
        } catch (err: any) {
          await dbService.updateWorkerTaskResult(job.jobId, taskId2, 'FAILED', err.message);
          // Non-fatal git diff error; continue to RCA synthesis
        }
      }
    }

    // -------------------------------------------------------------
    // Final RCA Synthesis Checkpoint
    // -------------------------------------------------------------
    logger.info(`[Orchestrator] Synthesizing subagent worker outputs into RCA Report...`);
    const llm = getLLMModel();
    let rcaMarkdown = '';

    if (llm) {
      const response = await llm.invoke([
        new SystemMessage(`You are Aegis AI Orchestrator. Synthesize the worker subagent outputs into a professional SRE Root Cause Analysis (RCA) report.`),
        new HumanMessage(`Incident: ${incident.errorClass} - ${incident.errorMessage}\nService: ${incident.serviceName} (${incident.version.resolvedRef})\n\nScoped Code:\n${JSON.stringify(scopedSnippets)}\n\nGit History:\n${gitHistoryResult}`),
      ]);
      rcaMarkdown = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    } else {
      rcaMarkdown = `# Aegis AI RCA Report - ${incident.serviceName}\n\n**Error:** \`${incident.errorClass}: ${incident.errorMessage}\`\n**Ref:** \`${incident.version.resolvedRef}\`\n**Target File:** \`${scopedSnippets[0]?.filePath || 'N/A'}\`\n\n*Code scoped successfully by Aegis Subagents.*`;
    }

    // Record Assistant RCA response & mark job COMPLETED in MongoDB
    await dbService.addPromptMessage(job.jobId, 'orchestrator', rcaMarkdown, 'OrchestratorAgent');
    await dbService.updateJobStatus(job.jobId, 'COMPLETED', rcaMarkdown);

    logger.info(`[Orchestrator] Incident investigation completed/resumed for ${job.jobId}.`);
    return rcaMarkdown;
  }
}

export const orchestratorAgent = new OrchestratorAgent();
