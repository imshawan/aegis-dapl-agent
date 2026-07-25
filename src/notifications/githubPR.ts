import { Octokit } from '@octokit/rest';
import { getConfigGithubToken } from '@/config/env';
import { NormalizedIncident } from '@/ingestion/types';
import { logger } from '@/utils/logger';

const octokit = new Octokit({
  auth: getConfigGithubToken(),
});

export interface ProposedPatch {
  filePath: string;
  newContent: string;
}

export interface PRResult {
  prUrl: string;
  prNumber: number;
  branchName: string;
}

/**
 * Creates a git branch and opens a draft Pull Request on GitHub with the proposed remediation fix.
 */
export async function createRemediationPR(
  owner: string,
  repo: string,
  incident: NormalizedIncident,
  rcaMarkdown: string,
  patches: ProposedPatch[]
): Promise<PRResult | null> {
  if (!getConfigGithubToken()) {
    logger.warn('[GitHubPR] GITHUB_TOKEN not configured. Skipping automated PR creation.');
    return null;
  }

  const baseBranch = incident.version.resolvedRef || 'main';
  const branchName = `fix/aegis-incident-${incident.incidentId.slice(0, 8)}`;

  try {
    // 1. Get SHA of base branch
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });

    const baseSha = refData.object.sha;

    // 2. Create new branch
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    });

    logger.info(`[GitHubPR] Created branch ${branchName} from ${baseBranch}`);

    // 3. Commit patches to new branch
    for (const patch of patches) {
      // Get file SHA if updating existing file
      let fileSha: string | undefined;
      try {
        const { data: fileData } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: patch.filePath,
          ref: branchName,
        });
        if ('sha' in fileData) {
          fileSha = fileData.sha;
        }
      } catch {
        // File is new
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: patch.filePath,
        message: `fix(aegis): automated remediation for ${incident.errorClass} [Incident ${incident.incidentId}]`,
        content: Buffer.from(patch.newContent).toString('base64'),
        branch: branchName,
        sha: fileSha,
      });

      logger.info(`[GitHubPR] Committed patch for ${patch.filePath}`);
    }

    // 4. Create Pull Request
    const { data: prData } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: `[Aegis AI] Remediation Fix for ${incident.errorClass}: ${incident.errorMessage.slice(0, 60)}`,
      head: branchName,
      base: baseBranch,
      body: `## Aegis AI Automated Remediation PR\n\n${rcaMarkdown}\n\n---\n*Note: This PR was generated automatically by Aegis AI. Please review thoroughly before merging.*`,
      draft: true,
    });

    logger.info(`[GitHubPR] Pull Request created successfully: ${prData.html_url}`);

    return {
      prUrl: prData.html_url,
      prNumber: prData.number,
      branchName,
    };
  } catch (error: any) {
    logger.error(`[GitHubPR] Failed to create Pull Request on ${owner}/${repo}: ${error.message}`);
    return null;
  }
}
