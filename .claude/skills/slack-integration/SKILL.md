---
name: slack-integration
description: Rules and patterns for extending Slack ingestion, conversational interactive routing, Block Kit notifications, and bot token messaging in Aegis.
---

# Slack Integration & Interactivity Skill

Use this skill when modifying Slack webhook receivers (`src/controllers/webhookController.ts`), interactive query routing (`src/notifications/slackQueryRouter.ts`), or Slack notifications (`src/notifications/slackNotifier.ts`).

## 1. Handling Incoming Slack Messages & Ingestion
In `webhookController.ts`, incoming Slack Events API payloads (`event.text`, `event.user`, `event.channel`, `event.ts`, `event.thread_ts`) MUST be evaluated in two stages:
1. **Interactive Status Query / Mid-Job Interrogation**:
   - Check if `thread_ts` exists and maps to an active job (`dbService.findJobByThreadTs`).
   - If not in a thread, check if the message text references an existing Job ID directly (e.g., regex pattern matching `job id sentry_live_50000`).
   - If a target job is resolved, reply 200 OK immediately with `status: 'acknowledged'` and route asynchronously to `handleMidJobSlackQuery`.
2. **New Incident Request**:
   - If no existing job matches, queue as a new debugging investigation.
   - Immediately invoke `sendSlackAcknowledgement({ channel, threadTs: ts, jobId, serviceName })` so the user knows the assigned master ID.
3. **Security & Authentication**:
   - **Signature Verification**: Validate Slack cryptographic signing secrets (`X-Slack-Signature` and timestamp headers) to prevent unauthorized webhook spoofing or replay attacks.
   - **SSRF Defense**: Outbound webhook URLs must be verified against private IP ranges and loopback interfaces unless authorized by firewall configuration.

## 2. Conversational Messaging (`sendSlackMessage`)
Always use `sendSlackMessage(channel, text, threadTs, blocks)` in `slackNotifier.ts` for sending conversational updates or status replies:
- **Primary Path**: Checks if `SLACK_BOT_TOKEN` is configured and calls `https://slack.com/api/chat.postMessage`. Remember to type `const data: any = await res.json();`.
- **Fallback Path**: Falls back to `SLACK_WEBHOOK_URL` if Bot Token messaging fails or is omitted.

## 3. Non-Blocking Status Reporting in Orchestrator
When formatting status updates in `orchestratorAgent.handleMidJobQuery(jobId, question)`:
- Do NOT pause or interrupt running BullMQ workers or LangGraph loops.
- Query a live read-only snapshot from MongoDB (`getJobById`).
- Include critical SRE context in the response: Master Job ID, Service Name, Error Class, Active Subagent Tool execution count (`job.workerTasks.length`), and Pull Request URL (`job.prUrl`).
