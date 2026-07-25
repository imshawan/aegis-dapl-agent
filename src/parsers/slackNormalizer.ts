import { NormalizedIncident } from '@/ingestion/types';
import { resolveVersion } from '@/parsers/sentryNormalizer';
import { parseRawStackTraceText, parseRawErrorHeader } from '@/parsers/rawStackTraceParser';

export interface SlackEventPayload {
  channel?: string;
  user?: string;
  text: string;
  serviceName?: string;
  commitSha?: string;
  releaseTag?: string;
  branchName?: string;
}

export function parseSlackPayload(payload: SlackEventPayload): NormalizedIncident {
  const text = payload.text || '';

  const serviceMatch = text.match(/service:([a-zA-Z0-9_\-]+)/i);
  const shaMatch = text.match(/(?:commit|sha|ref):([0-9a-fA-F]{7,40})/i);
  const tagMatch = text.match(/tag:([a-zA-Z0-9_\-.]+)/i);
  const branchMatch = text.match(/branch:([a-zA-Z0-9_\-/]+)/i);

  const serviceName = payload.serviceName || (serviceMatch ? serviceMatch[1] : 'slack-reported-service');
  const commitSha = payload.commitSha || (shaMatch ? shaMatch[1] : undefined);
  const tagId = payload.releaseTag || (tagMatch ? tagMatch[1] : undefined);
  const branchName = payload.branchName || (branchMatch ? branchMatch[1] : undefined);

  const version = resolveVersion(commitSha || tagId, {
    ...(commitSha ? { git_commit: commitSha } : {}),
    ...(tagId ? { release_tag: tagId } : {}),
    ...(branchName ? { branch: branchName } : {}),
  });

  const frames = parseRawStackTraceText(text);
  const { errorClass, errorMessage } = parseRawErrorHeader(text);

  return {
    incidentId: `slack_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    source: 'GENERIC',
    serviceName,
    environment: 'production',
    errorClass,
    errorMessage,
    timestamp: new Date().toISOString(),
    version,
    stackTrace: frames,
    rawPayload: payload as any,
  };
}
