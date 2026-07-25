import { Router, Request, Response } from 'express';
import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { alertQueue, isDuplicateAlert } from '@/queue/alertQueue';
import { logger } from '@/utils/logger';

export const webhookRouter = Router();

// Helper to queue normalized incidents cleanly across all sources
async function queueNormalizedIncident(normalizedIncident: ReturnType<typeof parseSentryPayload>, res: Response) {
  // 1. Check Deduplication Window (10 minutes)
  const isDup = await isDuplicateAlert(normalizedIncident);
  if (isDup) {
    logger.info(`[WebhookRouter] Skipping alert ${normalizedIncident.incidentId} (deduplicated: same error seen recently)`);
    res.status(200).json({ status: 'deduplicated', incidentId: normalizedIncident.incidentId });
    return;
  }

  // 2. Queue Incident for Async Processing
  await alertQueue.add('debug-incident', normalizedIncident, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });

  logger.info(`[WebhookRouter] Incident ${normalizedIncident.incidentId} (${normalizedIncident.source}) added to queue.`);
  res.status(202).json({
    status: 'queued',
    incidentId: normalizedIncident.incidentId,
    source: normalizedIncident.source,
    resolvedRef: normalizedIncident.version.resolvedRef,
    resolutionSource: normalizedIncident.version.resolutionSource,
    parsedFramesCount: normalizedIncident.stackTrace.length,
  });
}

// 1. Sentry APM Webhook Receiver
webhookRouter.post('/sentry', async (req: Request, res: Response) => {
  try {
    const normalized = parseSentryPayload(req.body);
    await queueNormalizedIncident(normalized, res);
  } catch (error: any) {
    logger.error(`[WebhookRouter] Error processing Sentry webhook: ${error.message}`);
    res.status(500).json({ error: 'Internal processing error', details: error.message });
  }
});

// 2. Slack Events API / Slash Command Receiver
webhookRouter.post('/slack', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    if (payload.type === 'url_verification') {
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    const normalized = parseSlackPayload({
      text: payload.text || payload.event?.text || '',
      user: payload.user_id || payload.event?.user,
      channel: payload.channel_id || payload.event?.channel,
    });

    await queueNormalizedIncident(normalized, res);
  } catch (error: any) {
    logger.error(`[WebhookRouter] Error processing Slack ingestion: ${error.message}`);
    res.status(500).json({ error: 'Internal processing error', details: error.message });
  }
});

// 3. Raw Text / Custom Logger / CLI Ingestion Endpoint
webhookRouter.post('/raw', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || !body.stackTraceText) {
      res.status(400).json({ error: 'Missing required "stackTraceText" field in JSON body' });
      return;
    }

    const normalized = parseRawTextPayload(body);
    await queueNormalizedIncident(normalized, res);
  } catch (error: any) {
    logger.error(`[WebhookRouter] Error processing Raw Text ingestion: ${error.message}`);
    res.status(500).json({ error: 'Internal processing error', details: error.message });
  }
});

// Health check endpoint
webhookRouter.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});
