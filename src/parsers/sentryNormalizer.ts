import { NormalizedIncident, StackFrame, VersionResolution } from '@/ingestion/types';
import { getConfigGithubDefaultOwner, getConfigGithubDefaultRepo } from '@/config/env';

export function resolveVersion(rawRelease?: string, rawTags?: Record<string, string>): VersionResolution {
  let commitSha: string | undefined;
  let tagId: string | undefined;
  let branchName: string | undefined;

  if (rawTags) {
    if (rawTags['git_commit'] || rawTags['commit_sha']) {
      commitSha = rawTags['git_commit'] || rawTags['commit_sha'];
    }
    if (rawTags['release_tag'] || rawTags['tag']) {
      tagId = rawTags['release_tag'] || rawTags['tag'];
    }
    if (rawTags['branch']) {
      branchName = rawTags['branch'];
    }
  }

  if (rawRelease) {
    const releaseStr = rawRelease.trim();
    const shaRegex = /^[0-9a-f]{7,40}$/i;
    if (shaRegex.test(releaseStr)) {
      commitSha = commitSha || releaseStr;
    } else if (releaseStr.startsWith('v') || releaseStr.includes('@')) {
      const parts = releaseStr.split('@');
      const tagCandidate = parts.length > 1 ? parts[1] : parts[0];
      if (shaRegex.test(tagCandidate)) {
        commitSha = commitSha || tagCandidate;
      } else {
        tagId = tagId || tagCandidate;
      }
    }
  }

  if (commitSha) {
    return {
      commitSha,
      tagId,
      branchName,
      resolvedRef: commitSha,
      resolutionSource: 'COMMIT_SHA',
    };
  }

  if (tagId) {
    return {
      commitSha,
      tagId,
      branchName,
      resolvedRef: tagId,
      resolutionSource: 'TAG_ID',
    };
  }

  if (branchName) {
    return {
      commitSha,
      tagId,
      branchName,
      resolvedRef: branchName,
      resolutionSource: 'BRANCH_NAME',
    };
  }

  return {
    resolvedRef: 'main',
    resolutionSource: 'DEFAULT_BRANCH',
  };
}

export function parseSentryPayload(payload: any): NormalizedIncident {
  const data = payload.data || payload;
  const event = data.event || data;

  const rawRelease = event.release || data.release;
  const tagsMap: Record<string, string> = {};
  
  if (Array.isArray(event.tags)) {
    event.tags.forEach(([key, val]: [string, string]) => {
      tagsMap[key] = val;
    });
  } else if (typeof event.tags === 'object') {
    Object.assign(tagsMap, event.tags);
  }

  const version = resolveVersion(rawRelease, tagsMap);

  const frames: StackFrame[] = [];
  const exceptionValues = event.exception?.values || [];
  
  for (const exc of exceptionValues) {
    const rawFrames = exc.stacktrace?.frames || [];
    for (const frame of rawFrames) {
      frames.push({
        filename: frame.filename || '',
        filePath: frame.filename || frame.abs_path || '',
        lineNumber: frame.lineno || 0,
        columnNumber: frame.colno,
        functionName: frame.function,
        inApp: frame.in_app ?? true,
        contextLines: frame.context_line ? {
          before: frame.pre_context || [],
          line: frame.context_line,
          after: frame.post_context || []
        } : undefined
      });
    }
  }

  const errorClass = exceptionValues[0]?.type || event.title || 'UnknownError';
  const errorMessage = exceptionValues[0]?.value || event.message || 'No error message provided';
  const serviceName = event.culprit || event.project_slug || tagsMap['service'] || 'default-service';
  const environment = event.environment || tagsMap['environment'] || 'production';

  const owner = getConfigGithubDefaultOwner() || 'owner';
  const repo = getConfigGithubDefaultRepo() || 'repo';

  const repository = { owner, repo };

  return {
    incidentId: event.event_id || `inc_${Date.now()}`,
    source: 'SENTRY',
    serviceName,
    environment,
    errorClass,
    errorMessage,
    timestamp: event.datetime || new Date().toISOString(),
    version,
    repository,
    stackTrace: frames,
    rawPayload: payload,
  };
}
