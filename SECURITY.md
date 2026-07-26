# Security Policy

The **Aegis DAPL Agent** core team takes security, firewall resilience, and credential protection seriously. We appreciate your efforts to responsibly disclose your findings, and we will make every effort to acknowledge your contributions and remediate vulnerabilities promptly.

---

## Supported Versions

We provide automated vulnerability patches and active incident response for the following release tracks:

| Version | Supported | Node.js Runtime | Status |
| :--- | :--- | :--- | :--- |
| `1.x.x` (Master) | :white_check_mark: Yes | `>= 22.0.0` | Active Development & Security Monitoring |
| `< 1.0.0` | :x: No | `< 22.0.0` | Unsupported Legacy Pre-releases |

---

## Webhook Authentication & Secret Management (`src/security/`)

In enterprise production deployments, incoming incident payloads (from Sentry, Slack, or CI/CD pipelines) must be rigorously authenticated before triggering autonomous reasoning loops or background debugging tasks. Aegis implements a tiered, zero-trust authentication architecture:

### 1. Zero-Trust Webhook Guardrail (`validateWebhookAccessKey`)
All incoming webhook POST requests to `/api/v1/webhooks/*` (excluding `/health`) are intercepted by the `validateWebhookAccessKey` middleware. The request must supply a valid, active access key token in the `accesskey` HTTP header. Missing or invalid keys are immediately rejected with **HTTP 401 Unauthorized** before any payload parsing or LLM token expenditure occurs.

### 2. Tiered Secret Hierarchy & Rotation
Aegis checks and caches access keys according to a strict enterprise priority hierarchy:
1. **AWS Secrets Manager (`SecretsManagerService`) — Primary Vault**:
   - Connects directly to AWS Secrets Manager using cloud-native IAM Roles for Service Accounts (IRSA) in EKS or ECS task roles (no static credentials required by default).
   - Features zero-downtime automated background rotation polling (`AccessKeyService.startAwsSecretRotationPolling`), ensuring SRE teams can rotate keys without restarting containers or dropping live investigations.
2. **Environment Variables (`AEGIS_ACCESS_KEYS`) — Secondary / K8s ESO**:
   - Supports Kubernetes External Secrets Operator (ESO) workflows where secrets are injected into container environment variables. Also serves as a "break-glass" emergency override during cloud IAM outages.
3. **Development Fallbacks — Strictly Disabled in Production**:
   - Development mock keys (`aegis_live_key_99x7`) are included solely for local testing (`npm run dev`) and automated unit test suites (`npm run test:auth`).
   - **Fail-Safe Guardrail**: Whenever `NODE_ENV=production`, default test keys are **strictly stripped and ignored**. If no AWS or environment keys are provided in production, Aegis defaults to 0 active keys and securely rejects all incoming webhooks.

---

## Reporting a Vulnerability

If you discover a potential security issue in Aegis—including but not limited to:
- **Firewall Bypasses**: Methods to evade `agentFirewall.ts` DoS payload ceilings, path traversal detectors, or prompt injection regex guards.
- **Credential Leakage**: Unhandled telemetry or database logs exposing API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, or `GITHUB_TOKEN`).
- **Distributed Mutex Race Conditions**: Flaws in Redis BullMQ lock release mechanisms permitting concurrent state corruption.
- **Dependency Vulnerabilities**: Critical CVEs in LangChain, BullMQ, Express, or Mongoose dependencies.

### Private Disclosure Process
**Please DO NOT create a public GitHub issue.** Instead, follow our private disclosure workflow:

1. **Email the Security Team**: Send a detailed report to **[github@imshawan.dev](mailto:github@imshawan.dev)** (or contact the maintainer directly at **github@imshawan.dev**).
2. **Provide Detailed Reproduction**: Include steps to reproduce the issue, sample payloads, curl commands, or stack traces demonstrating the vulnerability.
3. **Response SLA**:
   - **Triage Acknowledgment**: Within **24 hours** of submission.
   - **Severity Assessment & Patch Plan**: Within **72 hours**.
   - **Release & Advisories**: We target releasing a remediation release patch within **5 business days** for high-severity vulnerabilities.

---

## Safe Harbor & Ethical Testing Guidelines

We encourage ethical security researchers and automated testing agents to test Aegis within the following guidelines:
- **Test in Isolated Environments**: Perform stress testing and adversarial injection scans against local instances (`docker compose up -d`) or staging environments. Do not target community or production Slack bots, databases, or API queues.
- **No Destructive Exploitation**: Do not attempt to delete, alter, or corrupt data belonging to other users or organizations.
- **Respect Rate Limits**: Do not perform volumetric DoS attacks against third-party LLM providers (Google Gemini, OpenAI, Anthropic) or GitHub APIs using Aegis credentials.

Thank you for helping keep Aegis and its user community secure! 🛡️
