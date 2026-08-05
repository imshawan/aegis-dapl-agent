# Environment Variables Matrix

Copy the reference `.env.example` configuration file to initialize environment settings:

```bash
cp .env.example .env
```

| Variable Name | Status | Default | Description |
| :--- | :--- | :--- | :--- |
| `APP_NAME` | Optional | `aegis-dapl-agent` | Application identity string used in log telemetry and distributed mutex keys. |
| `PORT` | Optional | `3000` | HTTP port for incoming APM webhooks and health check endpoints. |
| `MONGODB_URI` | Required | `mongodb://localhost:27017/aegis_db` | Connection string for master relational job and checkpoint persistence. |
| `REDIS_HOST` / `PORT` | Required | `localhost` / `6379` | Redis host configuration for BullMQ job scheduling and distributed mutex locking. |
| `REDIS_LOCK_DURATION_MS` | Optional | `600000` | Distributed mutex lock TTL duration in milliseconds (default: 10 minutes). |
| `LOG_RETENTION_DAYS` | Optional | `14d` | Duration to keep auto-rotated zipped archive logs before deletion to prevent disk exhaustion. |
| `GEMINI_API_KEY` | Recommended | — | Primary API key for Google Gemini Generative AI endpoints. |
| `GEMINI_MODEL` | Optional | `gemini-1.5-pro-latest` | Google Gemini model identifier (supports `gemini-1.5-flash-latest`, `gemini-pro`). |
| `ANTHROPIC_API_KEY` | Optional | — | Failover API key for Anthropic Claude models. |
| `ANTHROPIC_MODEL` | Optional | `claude-3-5-sonnet-20241022` | Anthropic Claude model identifier. |
| `OPENAI_API_KEY` | Optional | — | Failover API key for OpenAI GPT models. |
| `OPENAI_MODEL` | Optional | `gpt-4o` | OpenAI model identifier (supports `gpt-4o`, `gpt-4-turbo`, `o1`). |
| `OLLAMA_BASE_URL` | Optional | `http://localhost:11434/v1` | Base URL for local Ollama or OpenAI-compatible on-premise LLM server. |
| `OLLAMA_MODEL` | Optional | — | Local Ollama model identifier (e.g., `llama3`, `qwen2.5-coder`, `deepseek-r1`) for air-gapped on-premise execution. |
| `LLM_QUERY_TIMEOUT_MS` | Optional | `30000` | Maximum timeout in milliseconds for mid-job Slack status query evaluation before engaging offline status fallback. Note: Does NOT apply to main background incident investigations, which run asynchronously without timeouts. |
| `GITHUB_TOKEN` | Required | — | Personal access token or GitHub App token with repository read/write permissions. |
| `SLACK_BOT_TOKEN` | Optional | — | Bot user OAuth token for Slack interactive mid-job thread routing and alert notifications. |
| `AEGIS_ACCESS_KEYS` | Optional | `aegis_live_key_99x7,...` | Comma-separated API access keys for zero-trust webhook authentication (Sentry, Slack, CI/CD). |
| `AWS_REGION` | Optional | `us-east-1` | AWS region for automated AWS Secrets Manager integration. |
| `AWS_SECRETS_MANAGER_SECRET_ID` | Optional | — | AWS Secret Name or ARN (`aegis/production/webhook-keys`) for zero-downtime automated access key rotation. |
| `AWS_SECRETS_MANAGER_REPO_ENVS_SECRET_ID` | Optional | — | AWS Secret Name or ARN containing a JSON dictionary of testing environment variables injected during the Verification Loop. |
| `AWS_REPO_ENVS_CACHE_TTL_MS` | Optional | `300000` | In-memory cache TTL for repository environments in milliseconds (default: 5 minutes) to prevent AWS API spam during aggressive test execution. |
| `AWS_SECRET_POLL_INTERVAL_MS` | Optional | `3600000` | Background rotation polling interval in milliseconds (default: 1 hour). |
| `AEGIS_WORKSPACE_DIR` | Optional | `/tmp/aegis-workspaces` | Directory path where target repositories are cloned for forensics and patching. |
| `AEGIS_MAX_REACT_ITERATIONS` | Optional | `15` | Maximum number of ReAct loop iterations allowed for deep code forensics before termination. |
| `AEGIS_REACT_TERMINATION_WARNING_TURNS` | Optional | `2` | Number of turns remaining before termination to inject the synthesis warning prompt. |
