import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getConfigGithubToken } from '@/config/env';
import { NormalizedIncident } from '@/ingestion/types';
import { logger } from '@/utils/logger';
import { WorkspaceManager } from '@/workspace/manager';

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
 * Creates a git branch, commits the patches locally, pushes to origin, and opens a draft Pull Request on GitHub.
 */
export async function createRemediationPR(
  jobId: string,
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
  const workspacePath = WorkspaceManager.getWorkspacePath(jobId);

  if (!fs.existsSync(workspacePath)) {
    logger.error(`[GitHubPR] Local workspace ${workspacePath} does not exist. Cannot create PR.`);
    return null;
  }

  try {
    // 1. Checkout new branch locally
    try {
      execSync(`git checkout -b ${branchName}`, { cwd: workspacePath, stdio: 'ignore' });
    } catch {
      logger.info(`[GitHubPR] Branch ${branchName} already exists locally. Resetting.`);
      execSync(`git checkout ${branchName}`, { cwd: workspacePath, stdio: 'ignore' });
      execSync(`git reset --hard origin/${baseBranch}`, { cwd: workspacePath, stdio: 'ignore' });
    }

    // 2. Apply patches to the local filesystem
    for (const patch of patches) {
      // Find the absolute path
      const output = execSync('git ls-files', { cwd: workspacePath, encoding: 'utf8' });
      const paths = output.split('\n').filter(Boolean);
      const normalizedTarget = '/' + patch.filePath.replace(/^\/+/, '');
      const matches = paths.filter((p) => normalizedTarget.endsWith('/' + p) || normalizedTarget === p || patch.filePath.endsWith('/' + p) || patch.filePath === p);

      let relativePath = matches.length > 0 ? matches.sort((a, b) => b.length - a.length)[0] : patch.filePath;
      const fullPath = path.join(workspacePath, relativePath);

      fs.writeFileSync(fullPath, patch.newContent, 'utf-8');
      logger.info(`[GitHubPR] Applied patch to local file: ${relativePath}`);
    }

    // 3. Commit and push
    execSync('git config user.email "aegis-bot@aegis.dev"', { cwd: workspacePath, stdio: 'ignore' });
    execSync('git config user.name "Aegis Remediation Bot"', { cwd: workspacePath, stdio: 'ignore' });
    execSync('git add .', { cwd: workspacePath, stdio: 'ignore' });

    // Check if there are changes to commit
    const status = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf8' });
    if (status.trim()) {
      execSync(`git commit -m "fix(aegis): automated remediation for ${incident.errorClass} [Incident ${incident.incidentId}]"`, { cwd: workspacePath, stdio: 'ignore' });
      logger.info(`[GitHubPR] Pushing branch ${branchName} to remote...`);
      execSync(`git push -u origin ${branchName} --force`, { cwd: workspacePath, stdio: 'ignore' });
    } else {
      logger.info(`[GitHubPR] No changes detected after applying patches. Skipping PR creation.`);
      return null;
    }

    // 4. Create or update Pull Request via Octokit
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
    logger.error(`[GitHubPR] Failed to create remediation PR: ${error.message}`);
    return null;
  }
}
