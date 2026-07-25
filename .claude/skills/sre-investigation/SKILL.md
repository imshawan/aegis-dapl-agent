---
name: sre-investigation
description: Guide for running, simulating, testing, and debugging autonomous SRE incident workflows, BullMQ queues, and ReAct loops in Aegis.
---

# SRE Investigation Workflow Skill

Use this skill when testing, debugging, or extending incident ingestion, BullMQ job scheduling, or the Orchestrator Dynamic Agentic Planning Loop (DAPL).

## 1. Simulating Incident Ingestion Offline
When testing ingestion without external webhooks, use the simulation test suite or invoke payload normalizers directly:
```bash
npm run test:simulation
```
- **Sentry APM**: `parseSentryPayload` extracts stack frames, filtering out external dependencies (`node_modules`, `site-packages`, `/usr/local/go/`) by setting `inApp: false`.
- **Slack Mentions**: `parseSlackPayload` normalizes conversational text and extracts repository/branch metadata.
- **Raw Tracebacks**: `parseRawTextPayload` handles Python, Node, and Go tracebacks.
- **Security & Secret Scrubbing**: All incoming webhook payloads and tracebacks MUST be sanitized to strip authorization tokens, database connection passwords, and PII before persisting to MongoDB or formatting into third-party LLM prompts.

## 2. Inspecting Master Job State in MongoDB / LFU Store
Every investigation is bound to a master `jobId` (e.g., `sentry_live_50000`).
When debugging job progression in `src/agent/orchestrator.ts`:
1. Check `job.status`: Valid states are `INITIATED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`.
2. Inspect `job.workerTasks`: Array containing subagent execution records (`CodeScoperWorker`, `GitDiffWorker`, `PatchWorker`). Ensure that each subagent checks for `status === 'COMPLETED'` before executing to prevent duplicate API calls across ReAct loop turns.
3. Review `job.promptMessages`: Contains the chronological reasoning history of the LLM and user mid-job Q&A interactions.

## 3. Testing DAPL Without API Keys
If LLM API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are omitted, `getLLMModel()` returns `null`.
The Orchestrator automatically drops into defensive heuristic simulation (`executeHeuristicFallback`):
```bash
npm run test:orchestrator
```
When debugging fallback logic, verify that all three subagents are executed sequentially and output a deterministic markdown RCA report without throwing authentication errors.
