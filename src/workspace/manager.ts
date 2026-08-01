import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '@/utils/logger';
import { getConfigGithubToken, getConfigAegisWorkspaceDir } from '@/config/env';

const execAsync = promisify(exec);

export class WorkspaceManager {
  /**
   * Retrieves the local file system path for a given job's cloned repository workspace.
   */
  static getWorkspacePath(jobId: string): string {
    const root = getConfigAegisWorkspaceDir();
    return path.join(root, jobId);
  }

  /**
   * Clones a repository locally for a specific job and target reference (branch/commit/tag).
   */
  static async initializeWorkspace(jobId: string, repoOwner: string, repoName: string, ref: string): Promise<string> {
    const workspacePath = this.getWorkspacePath(jobId);
    const token = getConfigGithubToken();
    
    // Use token for auth if available, else anonymous HTTPS
    const remoteUrl = token
      ? `https://oauth2:${token}@github.com/${repoOwner}/${repoName}.git`
      : `https://github.com/${repoOwner}/${repoName}.git`;

    logger.info(`[WorkspaceManager] Initializing local workspace for job ${jobId} at ${workspacePath} (ref: ${ref})`);

    // Ensure pristine workspace
    if (fs.existsSync(workspacePath)) {
      await this.cleanupWorkspace(jobId);
    }
    fs.mkdirSync(workspacePath, { recursive: true });

    try {
      // 1. Initialize empty git repo
      await execAsync(`git init`, { cwd: workspacePath });
      
      // 2. Add remote
      await execAsync(`git remote add origin ${remoteUrl}`, { cwd: workspacePath });
      
      // 3. Fetch shallow depth of specific ref
      await execAsync(`git fetch --depth 1 origin ${ref}`, { cwd: workspacePath });
      
      // 4. Hard reset to FETCH_HEAD
      await execAsync(`git reset --hard FETCH_HEAD`, { cwd: workspacePath });

      logger.info(`[WorkspaceManager] Successfully cloned ${repoOwner}/${repoName}@${ref} into ${workspacePath}`);
      return workspacePath;
    } catch (error: any) {
      logger.error(`[WorkspaceManager] Failed to initialize workspace for job ${jobId}: ${error.message}`);
      await this.cleanupWorkspace(jobId); // Cleanup partial clone
      throw error;
    }
  }

  /**
   * Recursively deletes the cloned repository workspace after completion.
   */
  static async cleanupWorkspace(jobId: string): Promise<void> {
    const workspacePath = this.getWorkspacePath(jobId);
    if (fs.existsSync(workspacePath)) {
      try {
        fs.rmSync(workspacePath, { recursive: true, force: true });
        logger.info(`[WorkspaceManager] Cleaned up workspace for job ${jobId}`);
      } catch (error: any) {
        logger.warn(`[WorkspaceManager] Failed to clean up workspace ${workspacePath}: ${error.message}`);
      }
    }
  }

  /**
   * Scans the cloned repository for AI rules (.cursorrules, skills/claude/md/rules, etc)
   * and returns them as a concatenated string to be injected into system prompts.
   */
  static async getRepositoryRules(jobId: string): Promise<string> {
    const workspacePath = this.getWorkspacePath(jobId);
    if (!fs.existsSync(workspacePath)) return '';

    try {
      const { stdout } = await execAsync('git ls-files', { cwd: workspacePath, encoding: 'utf8' });
      const paths = stdout.split('\n').filter(Boolean);

      const rulePatterns = [
        /\.cursorrules$/i,
        /\.cursor\/rules\/.*\.mdc?$/i,
        /\.windsurfrules$/i,
        /\.clinerules$/i,
        /\.roorules$/i,
        /\.github\/copilot-instructions\.md$/i,
        /\.github\/prompts\/.*\.md$/i,
        /(^|\/)\.claude\.md$/i,
        /(^|\/)claude[_-]?instructions\.md$/i,
        /(^|\/)\.claude\/(rules|skills|agent_docs)\/.*?\.(md|txt|mdc)$/i,
        /(^|\/)\.?agents?\/.*?\.(md|txt|mdc)$/i,
        /(^|\/)\.?codex\/.*?\.(md|txt|mdc)$/i,
        /(^|\/)(\.prompt|prompts?)\/.*?\.(md|txt)$/i,
        /(^|\/)system[_-]?prompt\.md$/i,
        /skills\/.*\/rules.*\.md$/i,
        /(^|\/)rules\.md$/i,
        /(^|\/)instructions\.md$/i,
        /(^|\/)CONTRIBUTING\.md$/i,
        /(^|\/)CODING[_-]?STANDARDS\.md$/i,
      ];

      const matchedPaths = paths.filter((p) => rulePatterns.some((regex) => regex.test(p)));
      if (matchedPaths.length === 0) return '';

      logger.info(`[WorkspaceManager] Found ${matchedPaths.length} repository rule files for job ${jobId}`);
      
      let rulesText = '\n\n=== REPOSITORY CUSTOM AI RULES ===\n';
      for (const p of matchedPaths) {
        const fullPath = path.join(workspacePath, p);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          rulesText += `\n--- ${p} ---\n${content}\n`;
        }
      }
      return rulesText;
    } catch (e: any) {
      logger.warn(`[WorkspaceManager] Failed to fetch repository rules for job ${jobId}: ${e.message}`);
      return '';
    }
  }
}
