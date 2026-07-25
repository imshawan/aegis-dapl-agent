import { Octokit } from '@octokit/rest';
import { getConfigGithubToken } from '@/config/env';
import { redisClient } from '@/queue/redis';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

const octokit = new Octokit({
  auth: getConfigGithubToken(),
});

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
function getSnippetCacheKey(owner: string, repo: string, ref: string, filePath: string, startLine: number, endLine: number): string {
  const hash = crypto.createHash('md5').update(`${owner}/${repo}:${ref}:${filePath}:${startLine}:${endLine}`).digest('hex');
  return `snippet:${hash}`;
}

/**
 * Dynamically resolves arbitrary container/build server absolute paths (e.g. /go/src/app/helpers/auth.go)
 * against the Git repository file tree without hardcoding static directory prefixes.
 */
async function resolveRepositoryPathViaGitTree(
  owner: string,
  repo: string,
  ref: string,
  rawPath: string
): Promise<string> {
  const cacheKey = `tree:${owner}/${repo}:${ref}`;
  let paths: string[] = [];
  if (redisClient.status !== 'end' && redisClient.status !== 'close') {
    try {
      const cachedTree = await redisClient.get(cacheKey);
      if (cachedTree) paths = JSON.parse(cachedTree);
    } catch {}
  }

  if (paths.length === 0) {
    try {
      const { data } = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: ref,
        recursive: 'true',
      });
      paths = data.tree.filter((t) => t.type === 'blob' && t.path).map((t) => t.path!);
      if (redisClient.status !== 'end' && redisClient.status !== 'close') {
        try {
          await redisClient.set(cacheKey, JSON.stringify(paths), 'EX', 3600);
        } catch {}
      }
    } catch (e: any) {
      logger.warn(`[GitHubScoper] Failed to fetch git tree for ${owner}/${repo}@${ref}: ${e.message}`);
      return rawPath;
    }
  }

  const normalizedTarget = '/' + rawPath.replace(/^\/+/, '');
  const matches = paths.filter((p) => normalizedTarget.endsWith('/' + p) || normalizedTarget === p || rawPath.endsWith('/' + p) || rawPath === p);
  if (matches.length > 0) {
    matches.sort((a, b) => b.length - a.length); // Prefer longest exact suffix match
    logger.info(`[GitHubScoper] Dynamically resolved path '${rawPath}' -> '${matches[0]}' via Git tree suffix matching.`);
    return matches[0];
  }

  const baseName = rawPath.split('/').pop() || '';
  const baseMatches = paths.filter((p) => p.endsWith('/' + baseName) || p === baseName);
  if (baseMatches.length === 1) {
    logger.info(`[GitHubScoper] Dynamically resolved path '${rawPath}' -> '${baseMatches[0]}' via unique filename matching.`);
    return baseMatches[0];
  }

  return rawPath;
}

/**
 * Fetches file content from GitHub and slices a token-efficient window around the error line (±20 lines).
 */
export async function getScopedCodeSnippet(
  owner: string,
  repo: string,
  resolvedRef: string,
  filePath: string,
  targetLineNumber: number,
  windowSize: number = 20
): Promise<ScopedSnippet | null> {
  let cleanPath = filePath;
  try { cleanPath = decodeURIComponent(cleanPath); } catch {}
  cleanPath = cleanPath.replace(/^\/+/, '');

  const startLine = Math.max(1, targetLineNumber - windowSize);
  const endLine = targetLineNumber + windowSize;
  const cacheKey = getSnippetCacheKey(owner, repo, resolvedRef, cleanPath, startLine, endLine);

  // 1. Check Redis Cache first (Prevents duplicate code reads / token waste)
  if (redisClient.status !== 'end' && redisClient.status !== 'close') {
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        return { ...parsed, fromCache: true };
      }
    } catch {
      // Ignore cache or connection errors and refetch
    }
  }

  let response: any;
  try {
    // 2. Fetch raw file from GitHub REST API using the resolved reference (Commit SHA -> Tag ID -> Branch)
    response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: cleanPath,
      ref: resolvedRef,
    });
  } catch {
    // Dynamically resolve against repository Git Tree without hardcoded prefixes!
    cleanPath = await resolveRepositoryPathViaGitTree(owner, repo, resolvedRef, cleanPath);
    try {
      response = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: cleanPath,
        ref: resolvedRef,
      });
    } catch (e: any) {
      logger.warn(`[GitHubScoper] Path '${cleanPath}' in ${owner}/${repo} is not a valid file or could not be fetched: ${e.message}`);
      return null;
    }
  }

  if (!('content' in response.data) || Array.isArray(response.data)) {
    logger.warn(`[GitHubScoper] Path ${cleanPath} in ${owner}/${repo} is not a valid file.`);
    return null;
  }

  // Decode base64 file content
  const fileContent = Buffer.from(response.data.content, 'base64').toString('utf-8');
  const lines = fileContent.split('\n');
  const totalLinesInFile = lines.length;

  // Adjust end line to total lines bound
  const actualEndLine = Math.min(totalLinesInFile, endLine);
  const zeroIndexedStart = Math.max(0, startLine - 1);
  const zeroIndexedEnd = actualEndLine;

  const slicedLines = lines.slice(zeroIndexedStart, zeroIndexedEnd);
  
  // Format snippet with line numbers
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
    } catch {
      // Ignore cache write errors in offline mode
    }
  }

  return result;
}
