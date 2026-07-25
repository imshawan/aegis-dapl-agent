import { NormalizedIncident } from '@/ingestion/types';
import { getScopedCodeSnippet, ScopedSnippet } from '@/context/githubScoper';
import { env } from '@/config/env';
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
    const owner = input.owner || input.incident.repository?.owner || env.GITHUB_DEFAULT_OWNER || 'owner';
    const repo = input.repo || input.incident.repository?.repo || input.incident.serviceName;
    const ref = input.incident.version.resolvedRef;

    const scopedSnippets: ScopedSnippet[] = [];
    const topFrames = input.incident.stackTrace.filter((f) => f.inApp).slice(0, 3);

    for (const frame of topFrames) {
      if (frame.filePath && frame.lineNumber) {
        const snippet = await getScopedCodeSnippet(owner, repo, ref, frame.filePath, frame.lineNumber, 20);
        if (snippet) {
          scopedSnippets.push(snippet);
        }
      }
    }

    logger.info(`[CodeScoperWorker] Scoped ${scopedSnippets.length} relevant code snippets.`);
    return scopedSnippets;
  }
}
