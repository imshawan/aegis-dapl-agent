import { execSync } from 'child_process';
import { logger } from '@/utils/logger';
import { WorkspaceManager } from '@/workspace/manager';

export interface GitDiffTaskInput {
  jobId: string;
  repo?: string;
  filePath: string;
}

export class GitDiffWorker {
  static readonly workerType = 'GitDiffWorker';

  async runTask(input: GitDiffTaskInput): Promise<string> {
    logger.info(`[GitDiffWorker] Fetching commit history for ${input.filePath} in local workspace...`);

    const workspacePath = WorkspaceManager.getWorkspacePath(input.jobId);

    try {
      // Execute git log locally
      const output = execSync(
        `git log -n 5 --pretty=format:"%h|%s|%an|%ad" --date=iso -- "${input.filePath}"`,
        { cwd: workspacePath, encoding: 'utf8' }
      );

      if (!output.trim()) {
        return '[]';
      }

      const commits = output.split('\n').filter(Boolean).map(line => {
        const [sha, message, author, date] = line.split('|');
        return { sha, message, author, date };
      });

      logger.info(`[GitDiffWorker] Retrieved ${commits.length} recent commits.`);
      return JSON.stringify(commits, null, 2);
    } catch (error: any) {
      logger.error(`[GitDiffWorker] Error fetching commits: ${error.message}`);
      return `Failed to fetch commits locally: ${error.message}`;
    }
  }
}
