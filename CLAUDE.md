# CLAUDE.md - Aegis (aegis-dapl-agent) Engineering & AI Agent Guide

Welcome to **Aegis** (`aegis-dapl-agent`), an enterprise-grade **Autonomous SRE Debugging & Remediation Engine** powered by a **Dynamic Agentic Planning Loop (DAPL)**. This document provides standardized guidelines, build commands, architectural rules, and development practices for AI coding assistants and engineering contributors.

---

## 🛠️ Key Build & Test Commands

```bash
# Build & Compilation
npm run build                     # Compile TypeScript to production bundle (dist/)
./node_modules/.bin/tsc --noEmit  # Run TypeScript type checker without emitting files
npm run dev                       # Launch development server with live reload (tsx watch)
npm start                         # Run production bundle (node dist/index.js)

# Verification & Diagnostics Suite (Run without needing external services)
npm run test:simulation           # Verify multi-source webhook normalizers (Sentry, Slack, Raw traceback)
npm run test:orchestrator         # Test DAPL ReAct loop + MongoDB relational checkpointing
npm run test:lfu                  # Test LFU memory store capacity overflow & fan-out eviction
npm run test:lock                 # Test Redis distributed mutex lock & audit trail
```

---

## 🏗️ Core Architectural Rules & Design Principles

When contributing code or adding new features to Aegis, you MUST adhere to the following core architectural pillars:

### 1. Master Relational Entity Enforcement (`jobId`)
- Every database record, worker execution task, AI prompt message, and GitHub PR reference MUST enforce **`jobId`** as its primary relational key / foreign key.
- Never create orphaned records or tasks in MongoDB or LFU memory without binding them to a master `jobId`.

### 2. Controller Layer Decoupling
- HTTP REST router definitions in `src/routes/` (`webhookRouter.ts`, `jobRouter.ts`) MUST NOT contain business logic, queue dispatching, or database calls.
- All routes must delegate directly to static methods in the controller layer (`src/controllers/webhookController.ts`, `jobController.ts`).

### 3. Unified API Response Formatting
- Every HTTP JSON response (success, acknowledgement, or error) MUST be formatted using `ApiResponseFormatter` in `src/utils/responseFormatter.ts`.
- Standard schema structure: `{ success: boolean, message: string, data?: any, error?: string, errorCode?: string, timestamp: string }`.

### 4. Subagent Checkpointing & Idempotency
- Before invoking expensive subagent tools (`CodeScoperWorker`, `GitDiffWorker`, `PatchWorker`), the Orchestrator MUST query MongoDB (`job.workerTasks.find(...)`).
- If a subagent task already completed in a previous loop turn or before a worker restart (`status === 'COMPLETED'`), reuse the checkpointed `outputResult` directly to save LLM tokens and ensure idempotency.

### 5. Offline Resilience & Sandbox Fallbacks
- Code must gracefully degrade when external services (Redis, MongoDB, LLM API keys) are disconnected or unavailable.
- **No API Keys**: Automatically drop into `executeHeuristicFallback` to simulate sequential subagent execution.
- **MongoDB Offline**: Automatically fall back to `LFUMemoryStore` with fan-out eviction (default max capacity: 500 jobs).
- **Redis Offline**: Distributed mutex locks (`src/lock/distributedLock.ts`) must check client connection state (`status === 'ready' | 'connect'`) and bypass cleanly to local execution without unhandled promise rejections.

### 6. Precision Block-Patching & Prefix Stripping
- Never overwrite entire files or rely on fragile regex replacements when generating remediation pull requests in `src/notifications/githubPR.ts`.
- Always strip container/OS path prefixes (`go/src/app/`, `var/www/html/`, `src/app/`) against `prefixesToRemove` to resolve exact repository relative paths.
- Use `findPatchLineRange` and `applyPatchToContent` to perform atomic drop-in block replacements while preserving surrounding code and comments.

### 7. Conversational Slack Interactivity & Concurrency
- When handling Slack webhooks, support both in-thread replies (`thread_ts`) and direct Job ID referencing in group channels/DMs (`overrideJobId`).
- Answering status checks (`orchestratorAgent.handleMidJobQuery`) MUST operate as a non-blocking read-only snapshot query against MongoDB without pausing or locking running ReAct worker loops.
- Use `sendSlackMessage` (supporting Slack Bot Token `chat.postMessage` with Incoming Webhook fallback) for conversational messaging.

### 8. Security & Compliance Governance
- **Secret Scrubbing**: Never persist un-sanitized API keys, database credentials, or PII from stack traces into MongoDB or pass them to external LLM providers.
- **Least Privilege Access**: Investigation subagents MUST use read-only GitHub scopes. Write operations are restricted exclusively to creating isolated draft remediation feature branches.
- **Input & Path Sanitization**: Validate file paths against directory traversal (`..`, `/etc/`, `/root/`) and never pass untrusted webhook or chat strings into shell execution or `eval()`.
- **Webhook Auth & SSRF**: Verify incoming cryptographic signatures (e.g., Slack `X-Slack-Signature`) and restrict outbound HTTP requests to prevent Server-Side Request Forgery.

---

## 📁 Module Directory Schema

```text
src/
├── agent/            # DAPL Orchestrator (orchestrator/index.ts), LangChain tool factories (orchestrator/tools.ts)
│   └── workers/      # Specialized worker subagents (codeScoperWorker, gitDiffWorker, patchWorker)
├── controllers/      # Decoupled business logic (webhookController.ts, jobController.ts)
├── routes/           # Clean REST route declarations (/api/v1/webhooks/*, /api/v1/jobs/*)
├── db/               # MongoDB persistence (dbService.ts), models (job.ts), and LFUMemoryStore fallback
├── queue/            # BullMQ incident processing (alertQueue.ts) and Redis connection management
├── lock/             # Distributed mutex locking (distributedLock.ts) and real-time audit logging
├── ingestion/        # Multi-source payload normalizers (Sentry APM, Slack Events/Commands, Raw traceback)
├── notifications/    # Slack status Q&A router, conversational Slack messaging, and GitHub PR generator
└── utils/            # JSON response formatter (ApiResponseFormatter) and Winston logger
```

---

## ✍️ Coding Style & Conventions

1. **Language & Targeting**: TypeScript 5.7+ targeting Node.js >= 18. Use strict ES6 modules and `@/*` path aliasing mapped to `src/*`.
2. **Logging**: Always use Winston logger (`import { logger } from '@/utils/logger';`). Never use `console.log` or `console.error` in production paths.
3. **Typing**: Provide explicit return types for all functions, methods, and async promises. Avoid explicit `any` where Zod schemas or TypeScript interfaces (`IJob`, `NormalizedIncident`) can be applied.
4. **Error Handling**: Use `try/catch` blocks with descriptive error logging and structured error responses. Pass custom diagnostic error codes (e.g., `ERR_SENTRY_INGESTION`, `ERR_SLACK_INGESTION`, `ERR_UNHANDLED_EXCEPTION`).
5. **Comments**: Maintain docstrings and explanatory comments for complex architectural patterns (e.g., ReAct loop state transitions, LFU eviction sorting, precision diff replacement).
