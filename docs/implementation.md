# Aegis (`aegis-dapl-agent`): Technical Implementation Guide

This document outlines the implementation details, module structure, and defensive reliability patterns built into **Aegis**.

---

## Module Structure & Core Components

| Module Directory | Key Files | Purpose & Description |
| :--- | :--- | :--- |
| **`src/agent/`** | `orchestrator.ts`<br>`incidentAgent.ts`<br>`subagents/*.ts` | Implements the **Dynamic Agentic Planning Loop (DAPL)** using LangGraph and LangChain tools. Manages autonomous worker subagent spawning and mid-job Slack queries. |
| **`src/db/`** | `dbService.ts`<br>`lfuMemoryStore.ts`<br>`models/job.ts` | Handles MongoDB persistence and **LFU (Least Frequently Used) memory store** fallback with automatic fan-out eviction. Enforces `jobId` master relational entity. |
| **`src/queue/`** | `alertQueue.ts`<br>`redis.ts` | Manages asynchronous incident processing via **BullMQ** and Redis. Provides 10-minute alert deduplication windows. |
| **`src/lock/`** | `distributedLock.ts`<br>`auditService.ts` | Distributed mutex locking with connection-state awareness and real-time audit logging to prevent concurrent race conditions on identical incidents. |
| **`src/ingestion/`** | `webhookRouter.ts`<br>`parsers/*.ts` | Modular multi-source webhook receivers (Sentry APM, Slack Events/Commands, Raw Python/Node tracebacks) that normalize payloads into `NormalizedIncident`. |
| **`src/notifications/`** | `slackQueryRouter.ts`<br>`githubPR.ts` | Slack thread-to-job resolver and automated GitHub remediation branch/PR creator. |

---

## Specialized Subagent Workers

Aegis encapsulates specific engineering debugging tasks into three core subagent workers:

### 1. `CodeScoperWorker` (`src/agent/workers/codeScoperWorker.ts`)
- **Responsibility**: Scopes source file code windows around target stack trace line numbers.
- **Behavior**: Reads repository content via Octokit, extracts ±20 lines of code around the error frame, and attaches version resolution metadata (`commit_sha`, `branch`, or `tag`).
- **Checkpointing**: Records execution under `workerTasks` in MongoDB with status `COMPLETED`.

### 2. `GitDiffWorker` (`src/agent/workers/gitDiffWorker.ts`)
- **Responsibility**: Investigates recent version control changes to identify regressions.
- **Behavior**: Fetches git commit logs, PR descriptions, and blame annotations for scoped files to determine if a recent change introduced the failure.

### 3. `PatchWorker` (`src/agent/workers/patchWorker.ts`)
- **Responsibility**: Formulates bug-free remediation patches based on scoped code and git history.
- **Behavior**: Outputs JSON patch definitions (`ProposedPatch[]`) containing target file paths, base SHAs, and replacement code strings ready for automated PR creation.

---

## Source Code & Version Resolution Pipeline
To accurately debug production issues without human intervention, Aegis resolves source code and version state through a three-stage pipeline:

### 1. Ingestion Normalization (`src/parsers/`)
- **Stack Frame Parsing**: Sentry APM, Slack, and raw traceback normalizers extract relative and absolute file paths (`filePath`) along with line numbers (`lineNumber`). Dependency directory structures (`node_modules`, `site-packages`, `/usr/local/go/`) are marked as `inApp: false`, ensuring debugging focuses strictly on application source code.
- **Version Ref Extraction**: Normalizers extract the exact production version reference (`resolvedRef`), prioritizing commit SHA, then release tag, and defaulting to branch name (e.g., `main`).

### 2. Repository Mapping (`src/agent/workers/codeScoperWorker.ts`)
- The worker establishes the GitHub repository target (`owner/repo`) by checking explicit payload parameters first (`incident.repository.owner` and `.repo`).
- If omitted, it correlates the reported `serviceName` against environment fallback defaults (`GITHUB_DEFAULT_OWNER`).

### 3. AST Window Extraction & Caching (`src/context/githubScoper.ts`)
- Calls `octokit.rest.repos.getContent` targeting `filePath` at the exact production `resolvedRef`.
- Slices a $\pm20$-line AST syntax window centered around the failure frame.
- Caches retrieved snippets in Redis using MD5 checksum hashing (`owner/repo:ref:filePath:startLine:endLine`) to eliminate duplicate GitHub REST API overhead during iterative ReAct investigation loops.

---

## Defensive Reliability & Fallback Patterns

### 1. Multi-Model LLM Support with Fallback
In `src/agent/incidentAgent.ts`, `getLLMModel()` dynamically scans environment variables in fallback order:
1. **Google Gemini** (`GEMINI_API_KEY` or `GOOGLE_API_KEY`): Instantiates `ChatGoogleGenerativeAI` using the model specified in `GEMINI_MODEL` (default: `gemini-1.5-pro-latest`).
2. **Anthropic Claude** (`ANTHROPIC_API_KEY`): Instantiates `ChatAnthropic` (`claude-3-5-sonnet-20241022`).
3. **OpenAI GPT** (`OPENAI_API_KEY`): Instantiates `ChatOpenAI` (`gpt-4o`).

### 2. Heuristic Simulation Mode (No API Key Required)
When running in local sandbox, CI/CD pipelines, or offline test environments where no LLM API keys are present, the orchestrator automatically drops into **defensive heuristic simulation mode** (`executeHeuristicFallback`). It sequentially executes all subagent worker tools and generates a deterministic markdown RCA report without failing or throwing authentication errors.

### 3. Redis Connection-State Aware Bypasses
To ensure robust local execution without hanging on disconnected Redis sockets:
- In `src/lock/distributedLock.ts` and `src/lock/auditService.ts`, all Redis locking and audit operations verify `redisClient.status === 'ready'` or `'connect'`.
- If Redis is offline (`status === 'end'`), distributed locks bypass cleanly into local fallback execution, logging warning diagnostics without throwing unhandled promise rejections.
- Lock TTL duration is dynamically configured via the `REDIS_LOCK_DURATION_MS` environment variable (default: `600000` ms / 10 minutes), replacing hardcoded timeouts in deduplication checks and mutex acquisitions.

### 4. LFU Fan-Out Memory Eviction
In `src/db/lfuMemoryStore.ts`, the custom `LFUMemoryStore` prevents exponential memory leaks:
```typescript
// When store exceeds maxSize (default 500), evict least frequently used keys:
if (this.store.size >= this.maxSize) {
  this.evictLeastUsed(); // Sorts by accessCount asc, then lastAccessed asc
}
```
Evicted entries are fanned out to an optional callback for clean archival logging.
