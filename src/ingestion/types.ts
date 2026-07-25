export interface StackFrame {
  filename: string;
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  functionName?: string;
  inApp: boolean;
  contextLines?: {
    before: string[];
    line: string;
    after: string[];
  };
}

export interface VersionResolution {
  commitSha?: string;
  tagId?: string;
  branchName?: string;
  resolvedRef: string; // The active ref chosen based on 1. Commit SHA -> 2. Tag ID -> 3. Branch Name (default 'main')
  resolutionSource: 'COMMIT_SHA' | 'TAG_ID' | 'BRANCH_NAME' | 'DEFAULT_BRANCH';
}

export interface NormalizedIncident {
  incidentId: string;
  source: 'SENTRY' | 'DATADOG' | 'SLACK' | 'GENERIC';
  serviceName: string;
  environment: string;
  errorClass: string;
  errorMessage: string;
  timestamp: string;
  version: VersionResolution;
  repository?: {
    owner: string;
    repo: string;
  };
  stackTrace: StackFrame[];
  rawPayload?: Record<string, any> | string;
  metadata?: {
    channelId?: string;
    threadTs?: string;
    userPrompt?: string;
    [key: string]: any;
  };
}
