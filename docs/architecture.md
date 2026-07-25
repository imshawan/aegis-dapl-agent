# Aegis (`aegis-dapl-agent`): Architecture Documentation

Aegis is an enterprise-grade **Autonomous SRE Debugging & Remediation Agent System** powered by a **Dynamic Agentic Planning Loop (DAPL)**. Unlike traditional procedural static pipelines, Aegis utilizes dynamic ReAct tool-calling loops, multi-model LLM orchestration (Google Gemini, Anthropic Claude, OpenAI GPT), and robust memory protection mechanisms.

---

## Picture of the Idea (System Architecture)

![Aegis DAPL Architecture](./architecture-diagram.svg)

---

## Core Architectural Pillars

### 1. Dynamic Agentic Planning Loop (DAPL)
At the heart of `aegis-dapl-agent` is the `OrchestratorAgent`. When an incident arrives, the orchestrator acts as an autonomous Lead Investigation SRE:
- **Analyze & Plan**: It evaluates stack traces, environment variables, and initial code snippets, listing hypotheses to test.
- **Autonomous Subagent Tool Calling**: Using `@langchain/core/tools`, it dynamically invokes specialized subagent workers as tools in a loop:
  - `spawn_code_scoper_worker`: Scopes AST code frames around target error lines.
  - `spawn_git_diff_worker`: Examines recent commits and blame annotations for regressions.
  - `spawn_patch_worker`: Formulates minimal, bug-free remediation code patches.
- **Iterative Evaluation**: The loop evaluates findings after each tool call, looping up to 10 turns until satisfied. Once root cause analysis (RCA) is complete, it automatically triggers a draft GitHub Pull Request with the proposed fix.

```mermaid
flowchart TD
    A[New Alert / Slack Question] --> B[Ingestion & Normalizer]
    B --> C{10-Min Deduplication Window}
    C -->|Duplicate| D[Discard Alert]
    C -->|New Incident| E[BullMQ Redis Queue]
    E --> F[Master Orchestrator ReAct Loop]
    
    subgraph Autonomous DAPL Loop
        F -->|Step 1: Formulate Plan| G[Decide Tool Execution]
        G -->|Call Tool| H1[CodeScoperWorker]
        G -->|Call Tool| H2[GitDiffWorker]
        G -->|Call Tool| H3[PatchWorker]
        
        H1 & H2 & H3 -->|Check DB Checkpoint| I{Already Completed?}
        I -->|Yes: Skip| J[Return Cached DB Output]
        I -->|No: Execute| K[Execute Subagent & Save to DB]
        
        J & K -->|Observation| L[Evaluate Findings]
        L -->|Needs More Context?| G
    end
    
    L -->|Goal Achieved| M[Synthesize Markdown RCA Report]
    M --> N[Create GitHub Remediation Branch & PR]
    N --> O[Send Notification via Slack]
```

---

### 2. Master Relational Entity Enforcement (`jobId`)
To ensure complete relational consistency across asynchronous distributed workers:
- Every database record, subagent execution checkpoint, LLM prompt message, and PR reference enforces **`jobId`** as its master relational entity / primary foreign key.
- If a subagent task (`CodeScoperWorker`) was already executed in a previous loop turn or retry, the orchestrator checks MongoDB first, returning cached results instantly to save LLM tokens and execution time.

---

### 3. Interactive Slack Routing, Status Q&A & Concurrency
Aegis supports live human-in-the-loop interrogation and instant status querying without pausing or interrupting active background investigation worker loops:
- **Immediate Acknowledgement**: When a new investigation is requested in Slack, Aegis immediately sends a conversational acknowledgement back to the thread containing the newly assigned master `jobId` and service details.
- **Flexible Status & Progress Queries**: Operators can interrogate active or completed investigations at any time by replying inside an ongoing thread (`thread_ts`) OR by messaging the bot directly in a group channel or DM with the Job ID (e.g., `"what is the status of task with job id - sentry_live_50000"`). The webhook controller uses word scanning and regex matching to resolve `overrideJobId` directly.
- **The Orchestrator POV (Stateless Compute + State-Centric Memory)**: From the Orchestrator's perspective, answering a status query does not require suspending or signaling the running ReAct loop thread. Instead, `handleMidJobQuery` reads a real-time snapshot of the job's MongoDB document (`status`, `workerTasks`, and recent `promptMessages`). It feeds this snapshot into a lightweight, read-only AI evaluation prompt (or deterministic markdown formatter) to generate an accurate progress report (including error class, worker tool counts, and Pull Request links), replying instantly in Slack via `chat.postMessage`.
- **Parallel Orchestrators & Multi-Job Concurrency**: When multiple outages occur concurrently, BullMQ assigns each alert to a distributed worker slot. Each job run operates as an isolated ReAct loop identified by its master relational entity (`jobId`). Because all state mutations (`addWorkerTask`, `updateWorkerTaskResult`, `addPromptMessage`) are scoped to `jobId` in MongoDB, parallel orchestrators execute concurrently without shared memory or state bleed. If a node restarts mid-job, a newly spawned orchestrator checks MongoDB first and reuses completed subagent checkpoints, ensuring crash resilience and idempotency across distributed runs.

```mermaid
flowchart TD
    subgraph Ingestion["Parallel Incident Ingestion"]
        A1["Alert 1: Payment Service 500"] --> B["BullMQ Redis Queue"]
        A2["Alert 2: Auth Service Nil Pointer"] --> B
    end

    subgraph Workers["Distributed Worker Slots (Parallel Concurrency)"]
        B -->|"Dispatch Slot 1"| C1["Orchestrator Instance 1\n(Job ID: sentry_50000)"]
        B -->|"Dispatch Slot 2"| C2["Orchestrator Instance 2\n(Job ID: sentry_50001)"]
        
        C1 -->|"Execute Subagents"| W1["CodeScoper / GitDiff / Patch"]
        C2 -->|"Execute Subagents"| W2["CodeScoper / GitDiff / Patch"]
    end

    subgraph Memory["State-Centric Memory (Master Relational Entity)"]
        W1 <-->|"Checkpoint Writes / Reads"| DB[("MongoDB / LFU Store\n(Keyed by jobId)")]
        W2 <-->|"Checkpoint Writes / Reads"| DB
    end

    subgraph Interrogation["Non-Blocking Slack Status Interrogation"]
        S1["Slack User: 'status of sentry_50000'\n(In-Thread or DM)"] --> R["WebhookController / QueryRouter"]
        R -->|"1. Pattern Match jobId"| R2["Resolve Target Job ID"]
        R2 -->|"2. Non-Blocking Read Snapshot"| DB
        DB -->|"3. Return Job State Snapshot\n(Status, WorkerTasks, Prompts)"| R3["Orchestrator Query Handler\n(Read-Only Synthesis)"]
        R3 -->|"4. Conversational Reply\n(chat.postMessage)"| S2["Slack Channel / DM Reply\n(PR Link, Error, Tool Progress)"]
    end

    style C1 fill:#1f6feb,stroke:#58a6ff,stroke-width:2px,color:#fff
    style C2 fill:#1f6feb,stroke:#58a6ff,stroke-width:2px,color:#fff
    style DB fill:#238636,stroke:#2ea043,stroke-width:2px,color:#fff
    style R3 fill:#8957e5,stroke:#d2a8ff,stroke-width:2px,color:#fff
```

---

### 4. LFU Fan-Out Memory Protection
To prevent exponential memory growth in high-throughput production environments:
- The in-memory fallback store (`LFUMemoryStore`) monitors active usage frequency (`accessCount`) and access timestamps (`lastAccessed`) for all job objects.
- When capacity is reached (default: 500 active jobs), it triggers a fan-out eviction mechanism that prunes the least frequently used keys, invoking an `onEvict` callback to archive or log evicted jobs cleanly.

---

### 5. Production Source Code & Version Resolution Pipeline
Aegis locates and accesses the exact source code for debugging production issues through a three-stage resolution pipeline that connects incoming alert payloads to version-controlled repository files:
- **Ingestion & Path Normalization**: When an incident webhook arrives (Sentry, Slack, or raw traceback), normalizers extract the failing file path (`filePath`) and the exact production version reference (`resolvedRef`)—prioritizing the commit SHA, falling back to release tag, and defaulting to branch name.
- **Repository & Owner Resolution**: The worker resolves the GitHub repository hierarchy (`owner/repo`) from explicit webhook metadata, correlating service names with environment fallbacks (`GITHUB_DEFAULT_OWNER`) when necessary.
- **AST Scoping via GitHub REST API**: The `CodeScoperWorker` calls `octokit.rest.repos.getContent` at the exact commit reference running in production, extracts a target AST window of $\pm20$ lines around the failure line, and caches the snippet in Redis using MD5 checksum hashing to eliminate redundant API calls across loop turns.
