import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { redisClient } from '@/queue/redis';
import { logger } from '@/utils/logger';
import { WorkspaceManager } from '@/workspace/manager';
import { getConfigGithubDefaultRepo } from '@/config/env';

export interface ScopedSnippet {
  filePath: string;
  resolvedRef: string;
  startLine: number;
  endLine: number;
  targetLineNumber: number;
  snippet: string;
  totalLinesInFile: number;
  fromCache: boolean;
  fullFileContent?: string;
}

/**
 * Calculates a unique Redis cache key for a specific code snippet.
 */
function getSnippetCacheKey(jobId: string, filePath: string, startLine: number, endLine: number): string {
  const hash = crypto.createHash('md5').update(`${jobId}:${filePath}:${startLine}:${endLine}`).digest('hex');
  return `snippet:local:${hash}`;
}

/**
 * Dynamically resolves arbitrary absolute paths against the local Git repository file tree.
 */
function resolveRepositoryPathLocally(
  workspacePath: string,
  rawPath: string
): string {
  try {
    const repoName = getConfigGithubDefaultRepo();
    if (repoName && rawPath.includes(`/${repoName}/`)) {
      const parts = rawPath.split(`/${repoName}/`);
      rawPath = parts.slice(1).join(`/${repoName}/`);
      logger.info(`[WorkspaceScoper] Trimmed absolute path using repo name: '${rawPath}'`);
    }

    const output = execSync('git ls-files', { cwd: workspacePath, encoding: 'utf8' });
    const paths = output.split('\n').filter(Boolean);

    const normalizedTarget = '/' + rawPath.replace(/^\/+/, '');
    const matches = paths.filter((p) => normalizedTarget.endsWith('/' + p) || normalizedTarget === p || rawPath.endsWith('/' + p) || rawPath === p);

    if (matches.length > 0) {
      matches.sort((a, b) => b.length - a.length); // Prefer longest exact suffix match
      logger.info(`[WorkspaceScoper] Dynamically resolved path '${rawPath}' -> '${matches[0]}' via local git ls-files.`);
      return matches[0];
    }

    const baseName = rawPath.split('/').pop() || '';
    const baseMatches = paths.filter((p) => p.endsWith('/' + baseName) || p === baseName);
    if (baseMatches.length === 1) {
      logger.info(`[WorkspaceScoper] Dynamically resolved path '${rawPath}' -> '${baseMatches[0]}' via unique filename matching.`);
      return baseMatches[0];
    }
  } catch (e: any) {
    logger.warn(`[WorkspaceScoper] Failed to resolve local git tree in ${workspacePath}: ${e.message}`);
  }
  return rawPath;
}

/**
 * Fetches file content from the local cloned workspace and slices a token-efficient window around the error line (±20 lines).
 */
export async function getScopedCodeSnippet(
  jobId: string,
  resolvedRef: string,
  filePath: string,
  targetLineNumber: number,
  windowSize: number = 20
): Promise<ScopedSnippet | null> {
  let cleanPath = filePath;
  try { cleanPath = decodeURIComponent(cleanPath); } catch { }
  cleanPath = cleanPath.replace(/^\/+/, '');

  const startLine = Math.max(1, targetLineNumber - windowSize);
  const endLine = targetLineNumber + windowSize;
  const cacheKey = getSnippetCacheKey(jobId, cleanPath, startLine, endLine);

  // 1. Check Redis Cache first
  if (redisClient.status !== 'end' && redisClient.status !== 'close') {
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        return { ...parsed, fromCache: true };
      }
    } catch { }
  }

  const workspacePath = WorkspaceManager.getWorkspacePath(jobId);
  if (!fs.existsSync(workspacePath)) {
    logger.warn(`[WorkspaceScoper] Workspace for job ${jobId} does not exist at ${workspacePath}`);
    return null;
  }

  cleanPath = resolveRepositoryPathLocally(workspacePath, cleanPath);
  const fullFilePath = path.join(workspacePath, cleanPath);

  if (!fs.existsSync(fullFilePath)) {
    logger.warn(`[WorkspaceScoper] Path ${cleanPath} does not exist in local workspace ${workspacePath}.`);
    return null;
  }

  // 2. Read local file directly
  const fileContent = fs.readFileSync(fullFilePath, 'utf-8');
  const lines = fileContent.split('\n');
  const totalLinesInFile = lines.length;

  const actualEndLine = Math.min(totalLinesInFile, endLine);
  const zeroIndexedStart = Math.max(0, startLine - 1);
  const zeroIndexedEnd = actualEndLine;

  const slicedLines = lines.slice(zeroIndexedStart, zeroIndexedEnd);

  const formattedSnippet = slicedLines
    .map((lineContent, idx) => {
      const currentLineNum = startLine + idx;
      const pointer = currentLineNum === targetLineNumber ? '-> ' : '   ';
      return `${pointer}${currentLineNum.toString().padStart(4, ' ')} | ${lineContent}`;
    })
    .join('\n');

  const result: ScopedSnippet = {
    filePath: cleanPath,
    resolvedRef,
    startLine,
    endLine: actualEndLine,
    targetLineNumber,
    snippet: formattedSnippet,
    totalLinesInFile,
    fromCache: false,
    fullFileContent: fileContent,
  };

  // Cache in Redis for 1 hour (3600 seconds)
  if (redisClient.status !== 'end' && redisClient.status !== 'close') {
    try {
      await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 3600);
    } catch { }
  }

  return result;
}
