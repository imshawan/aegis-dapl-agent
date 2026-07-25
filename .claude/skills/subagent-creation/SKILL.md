---
name: subagent-creation
description: Standardized best practices and template for creating or modifying specialized LangChain worker subagents and tools in Aegis.
---

# Subagent Creation & Tool Definition Skill

Use this skill when adding new specialized worker subagents or defining LangChain tools for the DAPL Orchestrator in `src/agent/`.

## 1. Subagent Architecture & Security Checklist
When creating a new worker (e.g., `src/agent/workers/myNewWorker.ts`):
- [ ] **Static Type**: Define a static `workerType` string (e.g., `'MyNewWorker'`).
- [ ] **Implementation**: Implement `runTask(input: { incident: NormalizedIncident, ... })` returning serializable JSON or markdown.
- [ ] **Least Privilege Access**: Ensure investigation workers use read-only GitHub scopes (`octokit.rest.repos.getContent`). Only remediation tools (`PatchWorker`, `githubPR.ts`) are allowed write access, restricted to draft PR branches.
- [ ] **Path Traversal Validation**: Sanitize target file paths (`filePath`). Reject directory traversal (`..`, `/etc/`, `/root/`) or paths outside target repository boundaries.
- [ ] **Command Injection Defense**: NEVER execute raw untrusted shell commands or `eval()` on strings ingested from external alerts or prompt reasoning.
- [ ] **Telemetry & Diagnostics**: Use `winston` logger (`logger.info(...)`) for all diagnostic telemetry. Handle API errors without crashing parent threads.

## 2. Defining LangChain Tools in Orchestrator
In `src/agent/orchestrator.ts`, expose the worker as a `@langchain/core/tools` tool inside `executeReActLoop`:

```typescript
const myNewTool = tool(
  async ({ filePath, instructionPrompt }) => {
    logger.info(`[OrchestratorTool] Invoking MyNewWorker for ${filePath}`);
    
    // 1. Check DB Checkpoint for Idempotency
    const existingTask = job.workerTasks.find((t) => t.workerType === MyNewWorker.workerType);
    if (existingTask && existingTask.status === 'COMPLETED' && existingTask.outputResult) {
      logger.info(`[OrchestratorTool] Reusing checkpointed MyNewWorker output from MongoDB.`);
      return existingTask.outputResult;
    }

    // 2. Initialize Task Record in MongoDB
    const taskId = existingTask?.taskId || `task_mynew_${Date.now()}`;
    if (!existingTask) {
      await dbService.addWorkerTask(job.jobId, taskId, MyNewWorker.workerType, instructionPrompt || `Execute task on ${filePath}`);
    }

    // 3. Execute Worker and Update Checkpoint
    try {
      const result = await this.myNewWorker.runTask({ incident });
      const resStr = JSON.stringify(result);
      await dbService.updateWorkerTaskResult(job.jobId, taskId, 'COMPLETED', resStr);
      return resStr;
    } catch (err: any) {
      await dbService.updateWorkerTaskResult(job.jobId, taskId, 'FAILED', err.message);
      return `Error in MyNewWorker: ${err.message}`;
    }
  },
  {
    name: 'spawn_my_new_worker',
    description: 'Clear description of when the LLM should call this subagent tool.',
    schema: z.object({
      filePath: z.string().describe('Target file path to inspect'),
      instructionPrompt: z.string().optional().describe('Specific instruction prompt'),
    }),
  }
);
```

## 3. Registering with LangGraph Loop
Ensure the new tool is added to the `tools` array passed into `createReactAgent({ llm, tools: [...] })` in `executeReActLoop`.
