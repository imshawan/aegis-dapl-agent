import { NormalizedIncident } from '@/ingestion/types';
import { getScopedCodeSnippet, ScopedSnippet } from '@/context/githubScoper';
import { getConfigGithubDefaultOwner } from '@/config/env';
import { AgentFirewall } from '@/security/agentFirewall';
import { logger } from '@/utils/logger';

export interface CodeScoperTaskInput {
  incident: NormalizedIncident;
  owner?: string;
  repo?: string;
}

export class CodeScoperWorker {
  static readonly workerType = 'CodeScoperWorker';

  async runTask(input: CodeScoperTaskInput): Promise<ScopedSnippet[]> {
    logger.info(`[CodeScoperWorker] Starting code framing for service ${input.incident.serviceName}...`);
    const owner = input.owner || input.incident.repository?.owner || getConfigGithubDefaultOwner() || 'owner';
    const repo = input.repo || input.incident.repository?.repo || input.incident.serviceName;
    const ref = input.incident.version.resolvedRef;

    const scopedSnippets: ScopedSnippet[] = [];
    const topFrames = input.incident.stackTrace.filter((f) => f.inApp).slice(0, 3);

    for (const frame of topFrames) {
      if (frame.filePath && frame.lineNumber) {
        const pathCheck = AgentFirewall.validateFilePath(frame.filePath);
        if (!pathCheck.safe) {
          logger.warn(`[CodeScoperWorker] Security Firewall blocked AST scoping on suspicious path: ${frame.filePath}`);
          continue;
        }

        const snippet = await getScopedCodeSnippet(owner, repo, ref, pathCheck.sanitizedPath, frame.lineNumber, 20);
        if (snippet) {
          scopedSnippets.push(snippet);
        }
      }
    }

    logger.info(`[CodeScoperWorker] Scoped ${scopedSnippets.length} relevant code snippets.`);
    return scopedSnippets;
  }
}
