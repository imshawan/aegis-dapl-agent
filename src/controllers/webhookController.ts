import { Request, Response } from 'express';
import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { alertQueue, isDuplicateAlert } from '@/queue/alertQueue';
import { dbService } from '@/db/dbService';
import { handleMidJobSlackQuery } from '@/notifications/slackQueryRouter';
import { sendSlackNotification, sendSlackMessage, sendSlackAcknowledgement } from '@/notifications/slackNotifier';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { AgentFirewall } from '@/security/agentFirewall';
import { logger } from '@/utils/logger';

export class WebhookController {
  /**
   * Helper to queue normalized incidents cleanly across all sources.
   */
  private static async queueNormalizedIncident(normalizedIncident: ReturnType<typeof parseSentryPayload>, res: Response): Promise<void> {
    // 0. Security Firewall Inspection (Prompt Injection, Jailbreak, & Path Traversal Defense)
    const rawTextStr = typeof normalizedIncident.rawPayload === 'string' 
      ? normalizedIncident.rawPayload 
      : normalizedIncident.rawPayload ? JSON.stringify(normalizedIncident.rawPayload) : (normalizedIncident.errorMessage || '');

    const firewallCheck = AgentFirewall.validateAndSanitizeInput(rawTextStr);
    if (!firewallCheck.safe) {
      logger.warn(`[WebhookController] Security Firewall blocked incident ${normalizedIncident.incidentId}: ${firewallCheck.violation}`);
      ApiResponseFormatter.error(res, 'Security Firewall Violation: Payload rejected', 403, firewallCheck.violation, 'ERR_SECURITY_FIREWALL');
      return;
    }

    // Sanitize error messages and raw payload to scrub PII / Secrets before queuing
    if (typeof normalizedIncident.rawPayload === 'string') {
      normalizedIncident.rawPayload = firewallCheck.sanitized;
    } else if (normalizedIncident.rawPayload && typeof normalizedIncident.rawPayload === 'object') {
      try {
        normalizedIncident.rawPayload = JSON.parse(firewallCheck.sanitized);
      } catch {
        normalizedIncident.rawPayload = firewallCheck.sanitized;
      }
    }
    if (normalizedIncident.errorMessage) {
      normalizedIncident.errorMessage = AgentFirewall.scrubSecretsAndPII(normalizedIncident.errorMessage);
    }

    // Verify all stack trace file paths against directory traversal and malicious inclusion
    for (const frame of normalizedIncident.stackTrace) {
      if (frame.filePath) {
        const pathCheck = AgentFirewall.validateFilePath(frame.filePath);
        if (!pathCheck.safe) {
          logger.warn(`[WebhookController] Security Firewall blocked suspicious stack frame path: ${frame.filePath}`);
          ApiResponseFormatter.error(res, 'Security Firewall Violation: Malformed or directory traversal file path detected in stack trace', 403, pathCheck.violation, 'ERR_SECURITY_FIREWALL');
          return;
        }
        frame.filePath = pathCheck.sanitizedPath;
      }
    }

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
    try {
      await alertQueue.add('debug-incident', normalizedIncident, {
        jobId: normalizedIncident.incidentId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
      logger.info(`[WebhookController] Incident ${normalizedIncident.incidentId} (${normalizedIncident.source}) added to queue.`);
    } catch (queueError: any) {
      if (queueError?.message?.includes('closed') || queueError?.message?.includes('Connection') || queueError?.message?.includes('connect') || queueError?.code === 'EPERM' || queueError?.code === 'ECONNREFUSED') {
        logger.warn(`[WebhookController] Redis offline (${queueError.message}). Bypassing BullMQ queue and creating Job ${normalizedIncident.incidentId} in DBService directly.`);
        await dbService.createJob(normalizedIncident, normalizedIncident.metadata?.channelId, normalizedIncident.metadata?.threadTs, normalizedIncident.metadata?.userPrompt);
      } else {
        throw queueError;
      }
    }
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

      // 0. Security Firewall Inspection (Prompt Injection & Jailbreak Defense for Slack messaging)
      const firewallCheck = AgentFirewall.validateAndSanitizeInput(text, true);
      if (!firewallCheck.safe) {
        logger.warn(`[WebhookController] Security Firewall blocked Slack message from user ${user}: ${firewallCheck.violation}`);
        ApiResponseFormatter.error(res, 'Security Firewall Violation: Slack prompt rejected due to malicious injection or jailbreak attempt', 403, firewallCheck.violation, 'ERR_SECURITY_FIREWALL');
        return;
      }

      // 1. Check if this message is a reply inside an existing thread OR references an existing Job ID directly
      let existingJob = threadTs ? await dbService.findJobByThreadTs(channel, threadTs) : null;
      let overrideJobId: string | undefined;

      if (!existingJob) {
        // Check if text mentions an existing job ID (e.g. "what is the status of task with job id - sentry_live_50000")
        const idMatch = text.match(/(?:job\s*id|status\s*of|task\s*id|job|status|task|id)[\s-:=]+([a-zA-Z0-9_\-]+)/i);
        if (idMatch && idMatch[1]) {
          const job = await dbService.getJobById(idMatch[1]);
          if (job) {
            existingJob = job;
            overrideJobId = job.jobId;
          }
        }

        // If regex didn't catch it, scan words for potential job IDs
        if (!existingJob) {
          const words = text.split(/\s+/).map((w) => w.replace(/^[^a-zA-Z0-9_\-]+|[^a-zA-Z0-9_\-]+$/g, ''));
          for (const word of words) {
            if (word.length > 4 && (word.startsWith('sentry_') || word.startsWith('slack_') || word.startsWith('job-') || word.startsWith('audit_') || word.includes('_'))) {
              const job = await dbService.getJobById(word);
              if (job) {
                existingJob = job;
                overrideJobId = job.jobId;
                break;
              }
            }
          }
        }
      }

      if (existingJob) {
        logger.info(`[WebhookController] Detected mid-job query / status check from user ${user}: "${text}" (Target Job: ${existingJob.jobId})`);

        // Respond 200 OK immediately so we don't block the Slack webhook receiver
        ApiResponseFormatter.success(
          res,
          {
            status: 'acknowledged',
            type: 'mid_job_query',
            jobId: existingJob.jobId,
            threadTs: threadTs || ts,
          },
          'Mid-job query received and being processed',
          200
        );

        // Process mid-job query asynchronously and reply directly to Slack
        handleMidJobSlackQuery({
          channelId: channel,
          threadTs: threadTs || ts,
          userQuestion: text,
          overrideJobId: overrideJobId || existingJob.jobId,
        })
          .then(async (replyText) => {
            await sendSlackMessage(channel, replyText, threadTs || ts);
          })
          .catch((err) => {
            logger.error(`[WebhookController] Error in background mid-job query handler: ${err.message}`);
          });
        return;
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

      // Send immediate Slack acknowledgement with the Job ID!
      await sendSlackAcknowledgement({
        channel,
        threadTs: ts,
        jobId: normalized.incidentId,
        serviceName: normalized.serviceName,
      });
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
