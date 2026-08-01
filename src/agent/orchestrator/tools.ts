import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { logger } from '@/utils/logger';
import { dbService } from '@/db/dbService';
import { IJob } from '@/db/models/job';
import { NormalizedIncident } from '@/ingestion/types';
import { CodeScoperWorker } from '@/agent/workers/codeScoperWorker';
import { GitDiffWorker } from '@/agent/workers/gitDiffWorker';
import { PatchWorker } from '@/agent/workers/patchWorker';
import { WorkspaceManager } from '@/workspace/manager';

export interface OrchestratorToolsContext {
  jobId: string;
  job: IJob;
  incident: NormalizedIncident;
  codeScoperWorker: CodeScoperWorker;
  gitDiffWorker: GitDiffWorker;
  patchWorker: PatchWorker;
}

/**
 * Creates and initializes LangChain subagent tools for the Lead Orchestrator.
 * Encapsulates worker invocation, MongoDB checkpointing, and Zod schemas.
 */
export function createOrchestratorTools(context: OrchestratorToolsContext) {
  const { jobId, job, incident, codeScoperWorker, gitDiffWorker, patchWorker } = context;

  const codeScoperTool = tool(
    async ({ filePath, lineNumber, instructionPrompt }) => {
      logger.info(`[OrchestratorTool] Invoking CodeScoperWorker for ${filePath}:${lineNumber || 'top'}`);
      const existingTask = job.workerTasks.find((t) => t.workerType === CodeScoperWorker.workerType);
      if (existingTask && existingTask.status === 'COMPLETED' && existingTask.outputResult) {
        logger.info(`[OrchestratorTool] Reusing checkpointed CodeScoperWorker output from MongoDB.`);
        return existingTask.outputResult;
      }

      const taskId = existingTask?.taskId || `task_scope_${Date.now()}`;
      if (!existingTask) {
        await dbService.addWorkerTask(jobId, taskId, CodeScoperWorker.workerType, instructionPrompt || `Scope code frames for ${filePath}`);
      }

      try {
        const snippets = await codeScoperWorker.runTask({ incident, jobId });
        const resStr = JSON.stringify(snippets);
        await dbService.updateWorkerTaskResult(jobId, taskId, 'COMPLETED', resStr);
        return resStr;
      } catch (err: any) {
        await dbService.updateWorkerTaskResult(jobId, taskId, 'FAILED', err.message);
        return `Error in CodeScoperWorker: ${err.message}`;
      }
    },
    {
      name: 'spawn_code_scoper_worker',
      description: 'Spawns a CodeScoper subagent to read AST frames and source snippets around target error lines.',
      schema: z.object({
        filePath: z.string().describe('Target file path to inspect'),
        lineNumber: z.number().optional().nullable().describe('Line number of the error'),
        instructionPrompt: z.string().optional().nullable().describe('Specific instruction prompt for the scoper worker'),
      }),
    }
  );

  const gitDiffTool = tool(
    async ({ filePath, instructionPrompt }) => {
      logger.info(`[OrchestratorTool] Invoking GitDiffWorker for ${filePath}`);
      const existingTask = job.workerTasks.find((t) => t.workerType === GitDiffWorker.workerType);
      if (existingTask && existingTask.status === 'COMPLETED' && existingTask.outputResult) {
        logger.info(`[OrchestratorTool] Reusing checkpointed GitDiffWorker output from MongoDB.`);
        return existingTask.outputResult;
      }

      const taskId = existingTask?.taskId || `task_git_${Date.now()}`;
      if (!existingTask) {
        await dbService.addWorkerTask(jobId, taskId, GitDiffWorker.workerType, instructionPrompt || `Fetch git history for ${filePath}`);
      }

      try {
        const history = await gitDiffWorker.runTask({
          jobId,
          filePath,
        });
        await dbService.updateWorkerTaskResult(jobId, taskId, 'COMPLETED', history);
        return history;
      } catch (err: any) {
        await dbService.updateWorkerTaskResult(jobId, taskId, 'FAILED', err.message);
        return `Error in GitDiffWorker: ${err.message}`;
      }
    },
    {
      name: 'spawn_git_diff_worker',
      description: 'Spawns a GitDiff subagent to inspect recent git commit history, PR diffs, and blame logs.',
      schema: z.object({
        filePath: z.string().describe('Target file path to inspect in git history'),
        instructionPrompt: z.string().optional().nullable().describe('Specific instruction prompt for the git diff worker'),
      }),
    }
  );

  const patchTool = tool(
    async ({ instructionPrompt }) => {
      logger.info(`[OrchestratorTool] Invoking PatchWorker to formulate code remediation diff`);
      const existingTask = job.workerTasks.find((t) => t.workerType === PatchWorker.workerType);
      if (existingTask && existingTask.status === 'COMPLETED' && existingTask.outputResult) {
        logger.info(`[OrchestratorTool] Reusing checkpointed PatchWorker output from MongoDB.`);
        return existingTask.outputResult;
      }

      const taskId = existingTask?.taskId || `task_patch_${Date.now()}`;
      if (!existingTask) {
        await dbService.addWorkerTask(jobId, taskId, PatchWorker.workerType, instructionPrompt);
      }

      try {
        // Gather checkpointed context from previous worker tasks
        const scopeTask = job.workerTasks.find((t) => t.workerType === CodeScoperWorker.workerType);
        const gitTask = job.workerTasks.find((t) => t.workerType === GitDiffWorker.workerType);
        let scopedSnippets = [];
        try { scopedSnippets = scopeTask?.outputResult ? JSON.parse(scopeTask.outputResult) : []; } catch { }
        const gitHistoryResult = gitTask?.outputResult || 'No git history available.';

        const patches = await patchWorker.runTask({
          incident,
          scopedSnippets,
          gitHistoryResult,
          jobId,
        });
        const resStr = JSON.stringify(patches, null, 2);
        await dbService.updateWorkerTaskResult(jobId, taskId, 'COMPLETED', resStr);
        return resStr;
      } catch (err: any) {
        await dbService.updateWorkerTaskResult(jobId, taskId, 'FAILED', err.message);
        return `Error in PatchWorker: ${err.message}`;
      }
    },
    {
      name: 'spawn_patch_worker',
      description: 'Spawns a PatchWorker subagent to formulate a minimal, bug-free JSON patch diff.',
      schema: z.object({
        instructionPrompt: z.string().describe('Specific instruction prompt detailing what bug to fix and how'),
      }),
    }
  );

  const readRepositoryFileTool = tool(
    async ({ filePath, startLine, endLine }) => {
      logger.info(`[OrchestratorTool] Invoking read_repository_file for ${filePath}`);
      const content = WorkspaceManager.readFile(jobId, filePath, startLine ?? undefined, endLine ?? undefined);
      if (!content) return `Error: File ${filePath} not found or could not be read.`;
      return content;
    },
    {
      name: 'read_repository_file',
      description: 'Reads a specific file from the repository. Use this to perform deep codebase forensics and understand dependencies. You can optionally slice it using startLine and endLine.',
      schema: z.object({
        filePath: z.string().describe('Target relative file path (e.g. src/utils/logger.ts)'),
        startLine: z.number().optional().nullable().describe('Optional start line (1-indexed)'),
        endLine: z.number().optional().nullable().describe('Optional end line (1-indexed)'),
      }),
    }
  );

  const searchRepositoryTool = tool(
    async ({ query, isRegex }) => {
      logger.info(`[OrchestratorTool] Invoking search_repository for query: ${query}`);
      return await WorkspaceManager.searchWorkspace(jobId, query, isRegex ?? false);
    },
    {
      name: 'search_repository',
      description: 'Executes a grep search across the repository. Use this to find usages of functions, definitions of interfaces, or track dependencies across files for deep forensics.',
      schema: z.object({
        query: z.string().describe('The search query (string or regex)'),
        isRegex: z.boolean().optional().nullable().describe('Set to true if query is a regular expression'),
      }),
    }
  );

  const toolsMap: Record<string, any> = {
    spawn_code_scoper_worker: codeScoperTool,
    spawn_git_diff_worker: gitDiffTool,
    spawn_patch_worker: patchTool,
    read_repository_file: readRepositoryFileTool,
    search_repository: searchRepositoryTool,
  };

  const toolsList = [codeScoperTool, gitDiffTool, patchTool, readRepositoryFileTool, searchRepositoryTool];

  return { toolsMap, toolsList };
}
