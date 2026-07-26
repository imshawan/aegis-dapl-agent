# Contributing to Aegis DAPL Agent

First off, thank you for considering contributing to **Aegis**! It is people and autonomous agents working together that make this project an enterprise-grade, self-healing site reliability system. 

The following document serves as a comprehensive guide for human developers, Site Reliability Engineers (SREs), and automated system maintainers contributing code, documentation, and security enhancements to Aegis.

---

## Table of Contents
1. [Code of Conduct](#code-of-conduct)
2. [Development Setup & Prerequisites](#development-setup--prerequisites)
3. [Architecture Overview](#architecture-overview)
4. [Development Workflow & Governance](#development-workflow--governance)
   - [Conventional Commits](#conventional-commits)
   - [Pre-commit Hooks & Secret Scanning](#pre-commit-hooks--secret-scanning)
5. [Testing Strategy](#testing-strategy)
6. [Submitting Pull Requests](#submitting-pull-requests)
7. [Security & Vulnerability Reporting](#security--vulnerability-reporting)

---

## Code of Conduct
By participating in this project, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). We expect all contributors to maintain a welcoming, empathetic, and professional environment for both human developers and autonomous AI agents.

---

## Development Setup & Prerequisites

To set up a local workstation for contributing to Aegis:

### 1. Prerequisites
- **Node.js**: `v22.0.0` or higher (we leverage Node 22 native test runner and fetch APIs).
- **npm**: `v10.0.0` or higher.
- **Docker & Docker Compose**: Required for running local Redis and MongoDB instances (or containerizing the full application).
- **Python / pip** *(Optional but recommended)*: For installing local `pre-commit` git hooks.

### 2. Initial Setup
Clone the repository and install dependencies using clean install:
```bash
git clone https://github.com/imshawan/aegis-dapl-agent.git
cd aegis-dapl-agent
npm ci
```

### 3. Environment Configuration
Copy the reference environment template and configure your local development API keys:
```bash
cp .env.example .env
```
*Note: To test autonomous ReAct loops locally, configure at least one LLM key (`GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`) and a `GITHUB_TOKEN`.*

### 4. Launching Local Services
Start local instances of Redis (BullMQ scheduling & distributed locks) and MongoDB (relational job memory):
```bash
docker compose up -d redis mongodb
```

---

## Architecture Overview
When contributing new features, adhere to our modular, domain-driven architecture:

- **`src/controllers/`**: HTTP traffic handlers and API response formatting (`ApiResponseFormatter`). **Mandate: All controller-level logic must reside in this directory.**
- **`src/routes/`**: Express route definitions mapping HTTP endpoints to controllers.
- **`src/security/`**: Runtime ingress firewall (`agentFirewall.ts`). Enforces DoS ceilings, secret redaction, and prompt injection defense.
- **`src/agent/`**: The Dynamic Agentic Planning Loop (`orchestrator/index.ts`), LangChain tool factories (`orchestrator/tools.ts`), and specialized subagents (`workers/*.ts`).
- **`src/db/`**: MongoDB schemas (`JobModel`), database adapters, and Redis lock managers.
- **`src/tests/`**: Native Node.js test harness verifying security, concurrency, parsing, and remediation.

---

## Development Workflow & Governance

We maintain strict repository governance to ensure automated SemVer versioning and AI root-cause traceability.

### Conventional Commits
All git commit messages must adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification as enforced by our `.commitlintrc.json`:
```
<type>(<optional scope>): <short summary in lower/sentence case>

[optional body]
```

**Allowed Commit Types:**
- `feat`: A new capability or feature.
- `fix`: A bug or regression fix.
- `security`: Security firewall updates, DoS ceiling adjustments, or vulnerability patches.
- `agent`: Modifications to orchestrator ReAct loops, prompt reasoning, or worker subagents.
- `test`, `docs`, `refactor`, `perf`, `chore`, `ci`, `build`, `revert`.

**Example:**
```bash
git commit -m "security(firewall): block directory traversal attempts in dot-env files"
git commit -m "agent(patch): add tab-to-space resiliency in block replacement engine"
```

### Pre-commit Hooks & Secret Scanning
We use `pre-commit` to automatically run syntax checks, conventional commit validation, and **Gitleaks secret scanning** before commits are created.

To install hooks locally:
```bash
pip install pre-commit
pre-commit install --hook-type pre-commit --hook-type commit-msg
```
*If Gitleaks flags a safe test placeholder string, add an explicit regex pattern to `.gitleaks.toml` under the `[allowlist]` section rather than bypassing the scanner.*

---

## Testing Strategy

Aegis uses the native Node.js test runner (`node:test` and `node:assert`) to eliminate external test framework bloat and hanging process bugs.

### Running Tests
Before submitting code, ensure the entire test suite passes:
```bash
# Execute all 40+ diagnostics across 16 test suites
npm run test

# Verify TypeScript type compilation without emitting artifacts
./node_modules/.bin/tsc --noEmit
```

### Adding New Tests
If you add a new feature, security rule, or worker capability, you must add corresponding unit or integration tests in `src/tests/`:
- **Security features**: Add positive and negative adversarial test cases in `testSecurityNegative.ts` or `testFirewall.ts`.
- **Worker patching**: Verify block replacement accuracy in `testGoRemediation.ts` or `testSimulation.ts`.
- **Database/Concurrency**: Ensure distributed Redis mutex locks are tested against race conditions in `testLock.ts`.

---

## Submitting Pull Requests

When you are ready to share your changes with the community:

1. **Fork and Branch**: Create a feature branch from `master` (e.g., `feature/async-slack-reply` or `fix/mongo-connection-retry`).
2. **Keep Changes Focused**: Ensure your Pull Request addresses a single clear objective. Avoid bundling unrelated architectural refactors with routine bug fixes.
3. **Verify Locally**: Run `npm run test` and `tsc --noEmit` to confirm zero regressions.
4. **Descriptive PR Title**: Use a Conventional Commit header for your PR title (e.g., `feat(slack): implement two-stage asynchronous status interrogation`).
5. **PR Summary**: In the Pull Request description, clearly explain:
   - **The Problem**: What bug or architectural limitation is being solved?
   - **The Solution**: How does your implementation address it?
   - **Verification**: Paste the summary output of `npm run test` showing all suites passing.
6. **Code Review**: A project maintainer (or automated review agent) will review your changes. Be prepared to discuss architectural trade-offs and iterate on feedback!

---

## Security & Vulnerability Reporting

If you discover a critical security vulnerability (such as a bypass in `agentFirewall.ts`, unhandled prompt injection vector, or credential leakage), **please do not open a public GitHub issue.**

Instead, please refer to our security reporting guidelines or email the maintainers directly at **[github@imshawan.dev](mailto:github@imshawan.dev)**. We will triage and issue a patch within 24 hours.

Thank you for contributing to Aegis! 🛡️🚀
