import { Request, Response } from 'express';
import os from 'os';
import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { alertQueue, isDuplicateAlert } from '@/queue/alertQueue';
import { dbService } from '@/db/dbService';
import { handleMidJobSlackQuery } from '@/notifications/slackQueryRouter';
import { sendSlackNotification, sendSlackMessage, sendSlackAcknowledgement } from '@/notifications/slackNotifier';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { AgentFirewall } from '@/security/agentFirewall';
import { logger } from '@/utils/logger';
import { formatUptime, getSystemLoad } from '@/utils/common';
import { AccessKeyService } from '@/security/accessKeyService';

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

  /**
   * Provides real-time control plane telemetry for authorized JWT sessions.
   * Returns host runtime location, active execution job counts, CPU/system load, memory utilization, and security shield status.
   */
  public static async getStats(req: Request, res: Response): Promise<void> {
      try {
        // 1. Gather Job & Queue Execution Metrics
        let activeJobsCount = 0;
        let waitingJobsCount = 0;
        let failedJobsCount = 0;
        let queueStatus = 'ONLINE (Redis BullMQ)';
  
        try {
          // Inspect BullMQ queue if Redis connection is active
          if (alertQueue && typeof alertQueue.getActiveCount === 'function') {
            activeJobsCount = await alertQueue.getActiveCount();
            waitingJobsCount = await alertQueue.getWaitingCount();
            failedJobsCount = await alertQueue.getFailedCount();
          }
        } catch (e: any) {
          queueStatus = 'OFFLINE (In-Memory Fallback Active)';
        }
  
        const totalJobsCount = await dbService.getTotalJobsCount();
        const completedJobsCount = await dbService.getCompletedJobsCount();
  
        // 2. Gather Host Location & Runtime Metrics
        const hostname = os.hostname();
        const osPlatform = os.platform();
        const osRelease = os.release();
        const osArch = os.arch();
        const nodeVersion = process.version;
        const v8Version = process.versions.v8 || 'V8';
        const pid = process.pid;
        const agentUptime = formatUptime(process.uptime());
        const hostUptime = formatUptime(os.uptime());
  
        // 3. Gather CPU & System Load Metrics
        const cpus = os.cpus();
        const cpuCores = cpus.length;
        const cpuModel = cpus[0]?.model || 'Generic ARM/x86 CPU';
        const loadAverage = getSystemLoad();
  
        // 4. Gather Memory & Cache Utilization
        const memUsage = process.memoryUsage();
        const rssMb = Math.round(memUsage.rss / 1024 / 1024);
        const heapUsedMb = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMb = Math.round(memUsage.heapTotal / 1024 / 1024);
        
        const totalSystemMem = os.totalmem();
        const totalMemGb = (totalSystemMem / 1024 / 1024 / 1024).toFixed(1);
        const rssPercent = ((memUsage.rss / totalSystemMem) * 100).toFixed(1);
        const heapUtilPercent = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);
  
        const rssMemory = `${rssMb} MB (${rssPercent}% of Host RAM)`;
        const heapMemory = `${heapUsedMb} MB / ${heapTotalMb} MB`;
  
        // 4b. Measure Event Loop Latency (critical SRE health indicator)
        const loopLatencyMs = await new Promise<number>((resolve) => {
          const start = performance.now();
          setImmediate(() => resolve(Math.round((performance.now() - start) * 100) / 100));
        });
  
        // 5. Gather Security & Ingress Status
        const activeKeysCount = AccessKeyService.listKeys().length;
  
        // Construct comprehensive telemetry response
        const telemetryData = {
          agentStatus: 'ACTIVE',
          timestamp: new Date().toISOString(),
          location: {
            hostname,
            platform: `${osPlatform} (${osRelease}) [${osArch}]`,
            pid,
          },
          runtime: {
            nodeVersion,
            v8Version,
            agentUptime,
            hostUptime,
          },
          execution: {
            activeJobsCount,
            waitingJobsCount,
            completedJobsCount,
            failedJobsCount,
            totalJobsCount,
            queueStatus,
          },
          systemLoad: {
            cpuModel,
            cpuCores,
            loadAverage,
          },
          memory: {
            rssMemory,
            heapMemory,
            eventLoopLatency: `${loopLatencyMs} ms`,
            utilizationPercent: heapUtilPercent,
          },
          security: {
            activeKeysCount,
          }
        };
  
        ApiResponseFormatter.success(res, telemetryData, 'Agent telemetry retrieved successfully.');
      } catch (err: any) {
        logger.error('[DashboardController] Error gathering stats:', err);
        ApiResponseFormatter.error(res, 'Failed to gather agent telemetry', 500, err.message, 'ERR_TELEMETRY_FAILED');
      }
    }
}
