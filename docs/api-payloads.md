# Aegis Ingestion API Payloads

Aegis supports multiple webhook integration points for seamless ingestion of crash data from various APMs and logging providers. All endpoints exist under the `/api/v1/webhooks/` path and are secured using the `X-Aegis-Access-Key` header.

> [!IMPORTANT]
> The target GitHub repository is configured via your `.env` file (`GITHUB_DEFAULT_OWNER` and `GITHUB_DEFAULT_REPO`). The webhooks below dictate the **context** of the crash (service name, stack trace, and version), but Aegis will always clone the repository defined in the environment config for the remediation process.

---

## 1. Raw Text Endpoint
**`POST /api/v1/webhooks/raw`**

The most flexible endpoint. Accepts a JSON payload containing the raw error stack trace string. Aegis will automatically extract the error class, error message, and file paths.

### Request Headers
```http
Content-Type: application/json
X-Aegis-Access-Key: <your_access_key>
```

### JSON Body Example
```json
{
  "serviceName": "gin-billing-service",
  "environment": "production",
  "branchName": "main",
  "stackTraceText": "panic: runtime error: invalid memory address or nil pointer dereference\n[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x102f5a0]\n\ngoroutine 42 [running]:\nmain.ValidateTransaction(0x0)\n\t/app/services/billing/transaction.go:42 +0x24\nmain.handleCheckout(0x140001a4000)\n\t/app/controllers/checkout.go:18 +0x88\ngithub.com/gin-gonic/gin.(*Context).Next(0x140001a4000)\n\t/go/pkg/mod/github.com/gin-gonic/gin@v1.9.1/context.go:174 +0x34"
}
```
### Schema Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `stackTraceText` | `string` | **Yes** | The raw multi-line string representation of the error stack trace. Aegis parses this to identify file paths and line numbers. |
| `serviceName` | `string` | No | Identifier for the affected service. Defaults to a generic name if omitted. |
| `environment` | `string` | No | Deployment environment (e.g., `production`, `staging`). |
| `commitSha` | `string` | No | Exact Git commit SHA to checkout. Takes highest precedence for version resolution. |
| `releaseTag` | `string` | No | Git tag associated with the deployed release. Used if `commitSha` is missing. |
| `branchName` | `string` | No | Branch name to checkout. Used if both `commitSha` and `releaseTag` are missing. |

---

## 2. Sentry APM Endpoint
**`POST /api/v1/webhooks/sentry`**

Natively parses standard Sentry Issue Webhook payloads. You can configure Aegis as a direct webhook integration inside your Sentry dashboard.

### Request Headers
```http
Content-Type: application/json
X-Aegis-Access-Key: <your_access_key>
```

### JSON Body Example
```json
{
  "project": "react-frontend-app",
  "project_name": "react-frontend-app",
  "level": "error",
  "event": {
    "event_id": "c138406798b34005a76785501fb758c0",
    "release": "v1.4.2",
    "environment": "production",
    "exception": {
      "values": [
        {
          "type": "TypeError",
          "value": "Cannot read properties of undefined (reading 'map')",
          "stacktrace": {
            "frames": [
              {
                "filename": "src/components/Dashboard.tsx",
                "abs_path": "/app/src/components/Dashboard.tsx",
                "lineno": 42,
                "colno": 15,
                "in_app": true,
                "function": "renderUserList"
              }
            ]
          }
        }
      ]
    },
    "tags": [
      ["git_commit", "7a8f9c1b"],
      ["environment", "production"]
    ]
  }
}
```
### Schema Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `event` | `object` | **Yes** | The core Sentry event data containing the exception stack trace and tags. |
| `project` | `string` | No | Identifier for the project. |
| `level` | `string` | No | Severity level of the event (e.g., `error`, `fatal`). |
| `event.release` | `string` | No | The software release version (often a commit SHA or semantic version tag). |
| `event.exception.values` | `array` | **Yes** | Array of exception objects containing `type`, `value`, and `stacktrace.frames`. |
| `event.tags` | `array`/`object` | No | Sentry tags. Aegis looks for `git_commit`, `commit_sha`, `release_tag`, `tag`, or `branch` for Git resolution. |

---

## 3. Slack Webhook Endpoint
**`POST /api/v1/webhooks/slack`**

Designed to ingest alerts forwarded from Slack bots or slash commands. It extracts metadata tags embedded inside the raw Slack text payload (e.g. `service:`, `commit:`, `branch:`).

### Request Headers
```http
Content-Type: application/json
X-Aegis-Access-Key: <your_access_key>
```

### JSON Body Example
```json
{
  "channel": "C12345678",
  "user": "U12345678",
  "text": "Alert! service:payment-gateway branch:main \n\nError: Null pointer exception in ValidateTransaction\n\ngoroutine 42 [running]:\nmain.ValidateTransaction(0x0)\n\t/app/services/billing/transaction.go:42 +0x24"
}
```
**Supported Inline Regex Tags (inside `text`)**: 
- `service:<name>`
- `commit:<sha>` or `sha:<sha>`
- `tag:<release>`
- `branch:<name>`

### Schema Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | **Yes** | The full text of the Slack message containing the stack trace and optional inline regex tags. |
| `channel` | `string` | No | Slack channel ID where the message originated. |
| `user` | `string` | No | Slack user ID who triggered the alert. |
| `serviceName` | `string` | No | Explicit service name override (if not using inline `service:` tag). |
| `commitSha` | `string` | No | Explicit commit SHA override (if not using inline `commit:` or `sha:` tag). |
| `releaseTag` | `string` | No | Explicit release tag override (if not using inline `tag:` tag). |
| `branchName` | `string` | No | Explicit branch override (if not using inline `branch:` tag). |
