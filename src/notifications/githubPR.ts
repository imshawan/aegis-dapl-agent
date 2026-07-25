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

    // 2. Create or reset branch
    try {
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      });
      logger.info(`[GitHubPR] Created branch ${branchName} from ${baseBranch}`);
    } catch (e: any) {
      if (e.status === 422 || (e.message && e.message.includes('Reference already exists'))) {
        logger.info(`[GitHubPR] Branch ${branchName} already exists. Force updating branch ref to ${baseSha}...`);
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: `heads/${branchName}`,
          sha: baseSha,
          force: true,
        });
        logger.info(`[GitHubPR] Successfully reset existing branch ${branchName} to ${baseSha}`);
      } else {
        throw e;
      }
    }

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

    // 4. Create or update Pull Request
    let prUrl = '';
    let prNumber = 0;
    const title = `[Aegis] Remediation Fix for ${incident.errorClass}: ${incident.errorMessage.slice(0, 60)}`;
    const body = `## Aegis Automated Remediation PR\n\n${rcaMarkdown}\n\n---\n*Note: This PR was generated automatically by Aegis. Please review thoroughly before merging.*`;

    try {
      const { data: prData } = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        head: branchName,
        base: baseBranch,
        body,
        draft: true,
      });
      prUrl = prData.html_url;
      prNumber = prData.number;
      logger.info(`[GitHubPR] Pull Request created successfully: ${prUrl}`);
    } catch (e: any) {
      if (e.status === 422 || (e.message && (e.message.includes('pull request already exists') || e.message.includes('A pull request already exists')))) {
        logger.info(`[GitHubPR] Pull request for branch ${branchName} already exists. Fetching and updating existing PR...`);
        const { data: existingPulls } = await octokit.rest.pulls.list({
          owner,
          repo,
          head: `${owner}:${branchName}`,
          state: 'open',
        });
        if (existingPulls.length > 0) {
          const existingPr = existingPulls[0];
          const { data: updatedPr } = await octokit.rest.pulls.update({
            owner,
            repo,
            pull_number: existingPr.number,
            title,
            body,
          });
          prUrl = updatedPr.html_url;
          prNumber = updatedPr.number;
          logger.info(`[GitHubPR] Successfully updated existing Pull Request #${prNumber}: ${prUrl}`);
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    return {
      prUrl,
      prNumber,
      branchName,
    };
  } catch (error: any) {
    logger.error(`[GitHubPR] Failed to create Pull Request on ${owner}/${repo}: ${error.message}`);
    return null;
  }
}
