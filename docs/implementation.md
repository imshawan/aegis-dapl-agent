# Aegis (`aegis-dapl-agent`): Technical Implementation Guide

This document outlines the implementation details, module structure, and defensive reliability patterns built into **Aegis**.

---

## Module Structure & Core Components

| Module Directory | Key Files | Purpose & Description |
| :--- | :--- | :--- |
| **`src/agent/`** | `orchestrator.ts`<br>`incidentAgent.ts`<br>`subagents/*.ts` | Implements the **Dynamic Agentic Planning Loop (DAPL)** using LangGraph and LangChain tools. Manages autonomous worker subagent spawning and mid-job Slack queries. |
| **`src/controllers/`** | `webhookController.ts`<br>`jobController.ts` | Handles request validation, deduplication, async queuing, and Slack job acknowledgements. Decouples business logic from HTTP router declarations. |
| **`src/routes/`** | `webhookRouter.ts`<br>`jobRouter.ts` | Clean REST routing definitions mapping endpoints (`/api/v1/webhooks/*`, `/api/v1/jobs/*`) directly to controller static methods. |
| **`src/db/`** | `dbService.ts`<br>`lfuMemoryStore.ts`<br>`models/job.ts` | Handles MongoDB persistence and **LFU (Least Frequently Used) memory store** fallback with automatic fan-out eviction. Enforces `jobId` master relational entity. |
| **`src/queue/`** | `alertQueue.ts`<br>`redis.ts` | Manages asynchronous incident processing via **BullMQ** and Redis. Provides 10-minute alert deduplication windows. |
| **`src/lock/`** | `distributedLock.ts`<br>`auditService.ts` | Distributed mutex locking with connection-state awareness and real-time audit logging to prevent concurrent race conditions on identical incidents. |
| **`src/ingestion/`** | `types.ts`<br>`parsers/*.ts` | Modular multi-source payload normalizers (Sentry APM, Slack Events/Commands, Raw tracebacks) that extract stack frames and version metadata into `NormalizedIncident`. |
| **`src/security/`** | `agentFirewall.ts` | **Agent Security Firewall**: Provides prompt injection defense, directory traversal protection, payload size ceilings, and automatic secret/PII scrubbing before ingestion or LLM evaluation. |
| **`src/notifications/`** | `slackQueryRouter.ts`<br>`slackNotifier.ts`<br>`githubPR.ts` | Slack thread/job ID status Q&A router, conversational Slack messaging (`chat.postMessage`), and automated GitHub remediation PR creator. |
| **`src/utils/`** | `responseFormatter.ts`<br>`logger.ts` | Implements `ApiResponseFormatter` for unified JSON schema structures (`success`, `message`, `data`, `error`, `timestamp`) across all API responses and error handlers. |

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

---

## Conversational Slack Routing & Status Q&A
Aegis integrates deep conversational interactivity and progress tracking into its Slack ingestion pipeline:

### 1. Instant Acknowledgement & Job ID Assignment (`sendSlackAcknowledgement`)
When a user tags the bot to report a new issue (e.g., `"Hey @Aegis can you look into this issue: <stack_trace>"`), `webhookController.ts` queues the job and immediately replies in the Slack thread with an acknowledgement containing the assigned master `jobId`, target service name, and queue status.

### 2. Flexible Status Interrogation (`handleMidJobSlackQuery`)
Operators can check the progress of any job at any time through two distinct mechanisms in `webhookController.ts`:
- **In-Thread Continuation**: Replying inside an existing investigation thread (`thread_ts`).
- **Direct Job ID Referencing**: Messaging the bot in a group channel or personal DM with an explicit ID (e.g., `"what is the status of job id - sentry_live_50000"`). Pattern matching automatically resolves `overrideJobId` to interrogate `getJobById`.

### 3. Non-Blocking Status Interrogation from Orchestrator POV
When `orchestratorAgent.handleMidJobQuery(jobId, question)` is invoked, it does **not** pause, suspend, or signal active worker threads. Instead, it reads a real-time snapshot of the job's MongoDB document (`status`, `workerTasks`, and recent `promptMessages`). It feeds this snapshot into an AI prompt or deterministic markdown formatter to generate an accurate progress report (including error class, worker tool execution counts, and Pull Request links). To prevent external LLM network retries from hanging background workers during API outages, evaluation is bounded by `LLM_QUERY_TIMEOUT_MS` (default 30,000 ms in production, 3,000 ms in test mode), replying asynchronously in Slack via `chat.postMessage`.

### 4. Parallel Orchestrators & Distributed Crash Resilience
When multiple outages occur simultaneously, BullMQ assigns each alert to a distributed worker slot running an independent Orchestrator instance:
- **Master Entity Isolation**: All database mutations enforce `jobId` as the primary relational key in MongoDB, eliminating shared memory contention across parallel executions.
- **Checkpointed Crash Recovery**: Before invoking subagent tools, parallel orchestrators check MongoDB (`job.workerTasks.find(...)`). If a subagent task already completed during a previous loop turn or before a node restart, the orchestrator reuses the checkpointed output directly from the database, ensuring idempotency and resilience across distributed worker nodes.

---

## Agent Security Firewall Layer
To shield the autonomous agent against prompt injection, directory traversal exploits, denial of service (DoS), and secret leakage, Aegis implements an impenetrable static security service (`src/security/agentFirewall.ts`) across all ingress points:

### 1. Ingress Shielding & Rejection Flow
When an alert or Slack chat message arrives at `webhookController.ts`, it is inspected before queue admission or LangGraph evaluation:
```typescript
const firewallCheck = AgentFirewall.validateAndSanitizeInput(rawText);
if (!firewallCheck.safe) {
  logger.warn(`[WebhookController] Security Firewall blocked incident: ${firewallCheck.violation}`);
  ApiResponseFormatter.error(res, 'Security Firewall Violation: Payload rejected', 403, firewallCheck.violation, 'ERR_SECURITY_FIREWALL');
  return; // 403 Forbidden - Never enters BullMQ queue!
}
```

### 2. Defense-in-Depth Pillars
- **Prompt Injection & Jailbreak Defense**: Scans text against adversarial patterns (`ignore previous instructions`, `system override`, `you are now an unrestricted agent`, `DAN mode`, `<|im_start|>`).
- **Path Traversal & OS Inclusion Defense**: Intercepts file paths in stack frames and tool arguments (`validateFilePath`), blocking directory traversal (`../../`) and access to sensitive OS/config files (`/etc/passwd`, `.env`, `.ssh/id_rsa`).
- **DoS Size Ceilings**: Enforces payload size limits (max 50 KB for stack traces, max 5 KB for conversational chat messages) to prevent OOM memory exhaustion.
- **Secret & PII Redaction**: Scrubs authorization headers, Google/OpenAI/Anthropic API keys, Slack bot tokens, database connection strings, and private key blocks (`[REDACTED_...]`).

---

## Precision Block-Patching & Indentation Resilience

Aegis handles code remediation across diverse programming languages (such as Go, TypeScript, and Python) through the `PatchWorker` (`src/agent/workers/patchWorker.ts`) block replacement engine:
- **Resilient Block Matching**: Attempts exact string search first; if formatting differences (such as tabs versus spaces in Go files) prevent exact matching, it degrades to trimmed line-by-line comparison.
- **Indentation Preservation**: Identifies leading indentation prefixes (`\t` or spaces) on matched source blocks and reconstructs replacement lines with identical indentation formatting.
- **Verification Harness**: Validated in `src/tests/testGoRemediation.ts` against real-world Go service controllers (defensive nil token checks and pointer dereferencing).

---

## Unified Native Test Harness (`npm run test`)

To ensure lightweight execution in CI/CD pipelines without external test framework bloat, Aegis standardizes on Node.js 22's native test runner (`node:test` and `node:assert`). All suites run via `tsx --test --test-force-exit`:
- **`test:lock`**: Distributed mutex lock acquisition and guard contexts.
- **`test:lfu`**: OOM memory overflow and fan-out eviction.
- **`test:orchestrator`**: Autonomous ReAct loop synthesis and non-blocking Slack queries.
- **`test:simulation`**: Sentry APM, Slack, and Python traceback webhook normalizers.
- **`test:firewall`**: Security ingress filtering, DoS ceilings, and secret scrubbing.
- **`test:security-negative`**: 18 adversarial negative test cases against prompt injection and path traversal exploits.
- **`test:go-remediation`**: Indentation-resilient block replacement in Go repositories.


