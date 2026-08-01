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
}
