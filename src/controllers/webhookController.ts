import { Request, Response } from 'express';
import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { alertQueue, isDuplicateAlert } from '@/queue/alertQueue';
import { dbService } from '@/db/dbService';
import { handleMidJobSlackQuery } from '@/notifications/slackQueryRouter';
import { sendSlackNotification } from '@/notifications/slackNotifier';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { logger } from '@/utils/logger';

export class WebhookController {
  /**
   * Helper to queue normalized incidents cleanly across all sources.
   */
  private static async queueNormalizedIncident(normalizedIncident: ReturnType<typeof parseSentryPayload>, res: Response): Promise<void> {
    // 1. Check Deduplication Window (10 minutes)
    const isDup = await isDuplicateAlert(normalizedIncident);
    if (isDup) {
      logger.info(`[WebhookController] Skipping alert ${normalizedIncident.incidentId} (deduplicated: same error seen recently)`);
      ApiResponseFormatter.success(
        res,
        {
          status: 'acknowledged',
          jobId: normalizedIncident.incidentId,
          deduplicated: true,
        },
        'Alert deduplicated: identical error occurred recently',
        200
      );
      return;
    }

    // 2. Queue Incident for Async Processing
    await alertQueue.add('debug-incident', normalizedIncident, {
      jobId: normalizedIncident.incidentId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    logger.info(`[WebhookController] Incident ${normalizedIncident.incidentId} (${normalizedIncident.source}) added to queue.`);
    ApiResponseFormatter.success(
      res,
      {
        status: 'acknowledged',
        jobId: normalizedIncident.incidentId,
        source: normalizedIncident.source,
        resolvedRef: normalizedIncident.version.resolvedRef,
        resolutionSource: normalizedIncident.version.resolutionSource,
        parsedFramesCount: normalizedIncident.stackTrace.length,
      },
      'Incident queued successfully for debugging',
      202
    );
  }

  /**
   * Sentry APM Webhook Receiver
   */
  static async handleSentryWebhook(req: Request, res: Response): Promise<void> {
    try {
      const normalized = parseSentryPayload(req.body);
      await WebhookController.queueNormalizedIncident(normalized, res);
    } catch (error: any) {
      logger.error(`[WebhookController] Error processing Sentry webhook: ${error.message}`);
      ApiResponseFormatter.error(res, 'Error processing Sentry webhook payload', 500, error.message, 'ERR_SENTRY_INGESTION');
    }
  }

  /**
   * Slack Events API / Slash Command Receiver
   */
  static async handleSlackWebhook(req: Request, res: Response): Promise<void> {
    try {
      const payload = req.body;
      if (payload.type === 'url_verification') {
        // Raw challenge response required by Slack Events API verification
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
          logger.info(`[WebhookController] Detected mid-job question in thread ${threadTs} from user ${user}: "${text}"`);

          // Respond 200 OK immediately so we don't block the Slack webhook receiver
          ApiResponseFormatter.success(
            res,
            {
              status: 'acknowledged',
              type: 'mid_job_query',
              jobId: existingJob.jobId,
              threadTs,
            },
            'Mid-job query received and being processed',
            200
          );

          // Process mid-job query asynchronously without interrupting workers
          handleMidJobSlackQuery({
            channelId: channel,
            threadTs,
            userQuestion: text,
          })
            .then(async (replyText) => {
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
              logger.error(`[WebhookController] Error in background mid-job query handler: ${err.message}`);
            });
          return;
        }
      }

      // 2. Otherwise, treat this as a New Incident Investigation Request
      logger.info(`[WebhookController] Detected new incident request in channel ${channel} from user ${user}`);
      const normalized = parseSlackPayload({
        text,
        user,
        channel,
      });

      normalized.metadata = {
        ...normalized.metadata,
        channelId: channel,
        threadTs: ts,
        userPrompt: text,
      };

      await WebhookController.queueNormalizedIncident(normalized, res);
    } catch (error: any) {
      logger.error(`[WebhookController] Error processing Slack ingestion: ${error.message}`);
      ApiResponseFormatter.error(res, 'Error processing Slack webhook payload', 500, error.message, 'ERR_SLACK_INGESTION');
    }
  }

  /**
   * Raw Text / Custom Logger / CLI Ingestion Endpoint
   */
  static async handleRawTextWebhook(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body;
      if (!body || !body.stackTraceText) {
        ApiResponseFormatter.error(res, 'Missing required "stackTraceText" field in JSON body', 400, null, 'ERR_MISSING_FIELD');
        return;
      }

      const normalized = parseRawTextPayload(body);
      await WebhookController.queueNormalizedIncident(normalized, res);
    } catch (error: any) {
      logger.error(`[WebhookController] Error processing Raw Text ingestion: ${error.message}`);
      ApiResponseFormatter.error(res, 'Error processing Raw Text payload', 500, error.message, 'ERR_RAW_INGESTION');
    }
  }

  /**
   * Health check endpoint
   */
  static async handleHealthCheck(req: Request, res: Response): Promise<void> {
    ApiResponseFormatter.success(res, { status: 'ok', timestamp: new Date().toISOString() }, 'Aegis Webhook Receiver Operational', 200);
  }
}
