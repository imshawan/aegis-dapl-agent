import { Octokit } from '@octokit/rest';
import { env } from '@/config/env';
import { redisClient } from '@/queue/redis';
import crypto from 'crypto';
import { logger } from '@/utils/logger';

const octokit = new Octokit({
  auth: env.GITHUB_TOKEN,
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
}

/**
 * Calculates a unique Redis cache key for a specific code snippet.
 */
function getSnippetCacheKey(owner: string, repo: string, ref: string, filePath: string, startLine: number, endLine: number): string {
  const hash = crypto.createHash('md5').update(`${owner}/${repo}:${ref}:${filePath}:${startLine}:${endLine}`).digest('hex');
  return `snippet:${hash}`;
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
  const startLine = Math.max(1, targetLineNumber - windowSize);
  const endLine = targetLineNumber + windowSize;
  const cacheKey = getSnippetCacheKey(owner, repo, resolvedRef, filePath, startLine, endLine);

  // 1. Check Redis Cache first (Prevents duplicate code reads / token waste)
  const cachedData = await redisClient.get(cacheKey);
  if (cachedData) {
    try {
      const parsed = JSON.parse(cachedData);
      return { ...parsed, fromCache: true };
    } catch {
      // Ignore parse errors and refetch
    }
  }

  try {
    // 2. Fetch raw file from GitHub REST API using the resolved reference (Commit SHA -> Tag ID -> Branch)
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref: resolvedRef,
    });

    if (!('content' in response.data) || Array.isArray(response.data)) {
      logger.warn(`[GitHubScoper] Path ${filePath} in ${owner}/${repo} is not a valid file.`);
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
      filePath,
      resolvedRef,
      startLine,
      endLine: actualEndLine,
      targetLineNumber,
      snippet: formattedSnippet,
      totalLinesInFile,
      fromCache: false,
    };

    // Cache in Redis for 1 hour (3600 seconds)
    await redisClient.set(cacheKey, JSON.stringify(result), 'EX', 3600);

    return result;
  } catch (error: any) {
    logger.error(`[GitHubScoper] Failed to fetch code snippet for ${filePath} @ ${resolvedRef} from GitHub: ${error.message}`);
    return null;
  }
}
