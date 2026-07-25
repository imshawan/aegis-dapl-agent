import { Router, Request, Response } from 'express';
import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { alertQueue, isDuplicateAlert } from '@/queue/alertQueue';
import { dbService } from '@/db/dbService';
import { handleMidJobSlackQuery } from '@/notifications/slackQueryRouter';
import { sendSlackNotification } from '@/notifications/slackNotifier';
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

    const event = payload.event || payload;
    const text: string = event.text || payload.text || '';
    const user: string = event.user || payload.user_id || 'unknown_user';
    const channel: string = event.channel || payload.channel_id || payload.channel || 'default_channel';
    const ts: string = event.ts || payload.ts || `${Date.now()}`;
    const threadTs: string | undefined = event.thread_ts || payload.thread_ts;

    // 1. Check if this message is a reply inside an existing investigation thread (Mid-Job Query)
    if (threadTs) {
      const existingJob = await dbService.findJobByThreadTs(channel, threadTs);
      if (existingJob) {
        logger.info(`[WebhookRouter] Detected mid-job question in thread ${threadTs} from user ${user}: "${text}"`);

        // Respond 200 OK immediately to Slack so we don't block the webhook receiver
        res.status(200).json({
          status: 'ok',
          type: 'mid_job_query',
          jobId: existingJob.jobId,
          threadTs,
        });

        // Process mid-job query asynchronously without interrupting workers
        handleMidJobSlackQuery({
          channelId: channel,
          threadTs,
          userQuestion: text,
        })
          .then(async (replyText) => {
            // Send reply notification to Slack
            await sendSlackNotification({
              incident: {
                incidentId: existingJob.jobId,
                source: 'SLACK',
                serviceName: existingJob.serviceName,
                environment: 'production',
                errorClass: existingJob.status,
                errorMessage: `Mid-Job Query Reply for thread ${threadTs}`,
                stackTrace: [],
                timestamp: new Date().toISOString(),
                version: existingJob.version || { resolutionSource: 'commit_sha', resolvedRef: 'main' },
              },
              rcaSummary: replyText,
            });
          })
          .catch((err) => {
            logger.error(`[WebhookRouter] Error in background mid-job query handler: ${err.message}`);
          });
        return;
      }
    }

    // 2. Otherwise, treat this as a New Incident Investigation Request (e.g. "@Aegis can you look at this issue: <stacktrace>")
    logger.info(`[WebhookRouter] Detected new incident request in channel ${channel} from user ${user}`);
    const normalized = parseSlackPayload({
      text,
      user,
      channel,
    });

    // Attach Slack routing metadata so Orchestrator can track thread_ts and prompts in MongoDB
    normalized.metadata = {
      ...normalized.metadata,
      channelId: channel,
      threadTs: ts, // Root ts becomes thread_ts for subsequent replies in thread
      userPrompt: text,
    };

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
