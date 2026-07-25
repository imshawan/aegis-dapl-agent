---
name: security-governance
description: Mandatory security, privacy, and compliance rules for autonomous subagents, webhook ingestion, LLM prompting, and GitHub remediation in Aegis.
---

# Security & Governance Skill

Use this skill whenever creating, modifying, or reviewing code in Aegis—especially when dealing with webhook ingestion, LLM prompts, subagent tools, or GitHub repository interactions.

## 1. Secret & PII Scrubbing (LLM Prompt & DB Protection)
Stack traces, HTTP request headers, environment variables, and raw log messages ingested from APM alerts frequently contain sensitive secrets (API keys, database passwords, JWT bearer tokens) and Personally Identifiable Information (PII like email addresses or phone numbers).
- **Mandatory Rule**: Before persisting incident data to MongoDB, caching in Redis, or formatting prompt strings for third-party LLM APIs (Google Gemini, OpenAI, Anthropic), all text MUST be sanitized.
- **Implementation**: Scrub authorization headers (`Authorization: Bearer <secret>`), connection strings (`mongodb://user:pass@host`), and environment secrets using regex replacement or sanitization utilities before passing payloads into LangGraph loops.

## 2. Least Privilege Repository Access
Aegis subagents interact with enterprise version control systems and must enforce the principle of least privilege:
- **Read-Only Scope**: Investigation workers (`CodeScoperWorker`, `GitDiffWorker`) MUST operate using read-only GitHub access tokens. They are strictly prohibited from mutating repository state, creating tags, or modifying files.
- **Restricted Write Scope**: Only remediation workers (`PatchWorker`, `githubPR.ts`) are permitted to perform GitHub write operations.
- **No Direct Master Commits**: All automated code changes MUST be committed to isolated, dynamically generated feature branches (e.g., `fix/aegis-incident-<id>`) and submitted as **Draft Pull Requests** for human peer review. Never commit or push directly to protected branches (`main`, `master`, `prod`).

## 3. Path Traversal & Command Injection Prevention
External webhook payloads (Sentry, Slack, raw JSON) represent untrusted user input:
- **Directory Traversal Defense**: When parsing file paths (`filePath`) in `src/ingestion/parsers/`, validate and normalize paths. Reject any path containing directory traversal sequences (`..`, `/etc/`, `/root/`, `C:\\Windows\\`) or absolute paths referencing local filesystem boundaries outside the target repository container.
- **No Remote Code Execution**: Subagents MUST NEVER pass untrusted strings, error messages, or Slack chat text into raw shell execution routines (`exec`, `spawn` without shell escaping) or `eval()`.

## 4. Webhook Authentication & Replay Attack Defense
In `src/controllers/webhookController.ts`:
- **Signature Verification**: Ensure incoming webhooks validate cryptographic signing secrets (e.g., Slack `X-Slack-Signature` and `X-Slack-Request-Timestamp` headers) to prevent unauthorized webhook spoofing and man-in-the-middle replay attacks.
- **URL Verification Challenge**: Promptly respond to Slack `url_verification` challenge handshakes without logging sensitive challenge tokens.

## 5. SSRF (Server-Side Request Forgery) Protection
When sending outgoing webhooks or calling external API endpoints in `src/notifications/`:
- Validate target URLs against private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.1`, `169.254.169.254` AWS metadata service) to prevent Server-Side Request Forgery attacks unless explicitly authorized in enterprise firewall configurations.
