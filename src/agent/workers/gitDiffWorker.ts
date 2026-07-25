import { Octokit } from '@octokit/rest';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

export interface GitDiffTaskInput {
  owner?: string;
  repo: string;
  filePath: string;
}

export class GitDiffWorker {
  static readonly workerType = 'GitDiffWorker';
  private octokit = new Octokit({ auth: env.GITHUB_TOKEN });

  async runTask(input: GitDiffTaskInput): Promise<string> {
    logger.info(`[GitDiffWorker] Fetching commit history for ${input.filePath}...`);
    const owner = input.owner || env.GITHUB_DEFAULT_OWNER || 'owner';

    if (!env.GITHUB_TOKEN) {
      return 'GitHub token not configured. Unable to fetch git commit history.';
    }

    try {
      const response = await this.octokit.rest.repos.listCommits({
        owner,
        repo: input.repo,
        path: input.filePath,
        per_page: 5,
      });

      const commits = response.data.map((c) => ({
        sha: c.sha.slice(0, 7),
        message: c.commit.message.split('\n')[0],
        author: c.commit.author?.name,
        date: c.commit.author?.date,
      }));

      logger.info(`[GitDiffWorker] Retrieved ${commits.length} recent commits.`);
      return JSON.stringify(commits, null, 2);
    } catch (error: any) {
      logger.error(`[GitDiffWorker] Error fetching commits: ${error.message}`);
      return `Failed to fetch commits: ${error.message}`;
    }
  }
}
