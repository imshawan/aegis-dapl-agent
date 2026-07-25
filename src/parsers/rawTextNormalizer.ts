import { NormalizedIncident } from '@/ingestion/types';
import { resolveVersion } from '@/parsers/sentryNormalizer';
import { parseRawStackTraceText, parseRawErrorHeader } from '@/parsers/rawStackTraceParser';

export interface RawTextIngestBody {
  serviceName?: string;
  environment?: string;
  commitSha?: string;
  releaseTag?: string;
  branchName?: string;
  stackTraceText: string;
}

export function parseRawTextPayload(body: RawTextIngestBody): NormalizedIncident {
  const text = body.stackTraceText || '';

  const version = resolveVersion(body.commitSha || body.releaseTag, {
    ...(body.commitSha ? { git_commit: body.commitSha } : {}),
    ...(body.releaseTag ? { release_tag: body.releaseTag } : {}),
    ...(body.branchName ? { branch: body.branchName } : {}),
  });

  const frames = parseRawStackTraceText(text);
  const { errorClass, errorMessage } = parseRawErrorHeader(text);

  return {
    incidentId: `raw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    source: 'GENERIC',
    serviceName: body.serviceName || 'raw-reported-service',
    environment: body.environment || 'production',
    errorClass,
    errorMessage,
    timestamp: new Date().toISOString(),
    version,
    stackTrace: frames,
    rawPayload: body as any,
  };
}
