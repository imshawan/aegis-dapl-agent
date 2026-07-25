import { NormalizedIncident } from '@/ingestion/types';
import { logger } from '@/utils/logger';
import { getConfigSlackWebhookUrl, getConfigSlackBotToken } from '@/config/env';

export interface SlackNotificationInput {
  incident: NormalizedIncident;
  rcaSummary: string;
  prUrl?: string;
  webhookUrl?: string;
}

export interface SlackAckInput {
  channel: string;
  threadTs?: string;
  jobId: string;
  serviceName?: string;
}

/**
 * Helper to send a conversational text or Block Kit message to a Slack channel/DM or thread.
 * Uses Slack Bot Token (chat.postMessage) when available, falling back to Incoming Webhook URL.
 */
export async function sendSlackMessage(channel: string, text: string, threadTs?: string, blocks?: any[]): Promise<boolean> {
  const botToken = getConfigSlackBotToken();
  const webhookUrl = getConfigSlackWebhookUrl();

  const payload: any = {
    text,
    ...(channel ? { channel } : {}),
    ...(threadTs ? { thread_ts: threadTs } : {}),
    ...(blocks ? { blocks } : {}),
  };

  // 1. Try Slack Bot Token first (supports replying to specific DMs, channels, and threads)
  if (botToken && channel) {
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${botToken}`,
        },
        body: JSON.stringify(payload),
      });
      const data: any = await res.json();
      if (data.ok) {
        logger.info(`[SlackNotifier] Sent message to Slack channel/DM ${channel}${threadTs ? ` (thread ${threadTs})` : ''}.`);
        return true;
      } else {
        logger.warn(`[SlackNotifier] chat.postMessage failed: ${data.error}. Falling back to webhook if configured.`);
      }
    } catch (e: any) {
      logger.warn(`[SlackNotifier] Error calling chat.postMessage: ${e.message}`);
    }
  }

  // 2. Fall back to Incoming Webhook URL
  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        logger.info('[SlackNotifier] Sent message via Incoming Webhook.');
        return true;
      }
    } catch (e: any) {
      logger.error(`[SlackNotifier] Failed to send webhook message: ${e.message}`);
    }
  }

  logger.info(`[SlackNotifier] Outputting Slack Message to console (No Slack token/webhook available):\n${text}`);
  return false;
}

/**
 * Sends an immediate acknowledgement back to Slack when a new investigation is queued.
 */
export async function sendSlackAcknowledgement(input: SlackAckInput): Promise<boolean> {
  const text = `Acknowledged! Aegis has initiated an autonomous debugging investigation for this issue.\n• *Master Job ID*: \`${input.jobId}\`\n• *Service*: \`${input.serviceName || 'unknown-service'}\`\n• *Status*: \`QUEUED\`\n\nYou can ask me for status updates anytime by replying to this thread or asking: \`what is the status of job id ${input.jobId}\``;
  return sendSlackMessage(input.channel, text, input.threadTs);
}

/**
 * Sends a rich Slack Block Kit notification containing the Aegis RCA summary and PR link.
 */
export async function sendSlackNotification(input: SlackNotificationInput): Promise<boolean> {
  const webhookUrl = input.webhookUrl || getConfigSlackWebhookUrl();
  const botToken = getConfigSlackBotToken();
  const channelId = input.incident.metadata?.channelId;
  const threadTs = input.incident.metadata?.threadTs;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `[Aegis] Incident Report - ${input.incident.serviceName}`,
        emoji: false,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Service:* \`${input.incident.serviceName}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Environment:* \`${input.incident.environment}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Error:* \`${input.incident.errorClass}\``,
        },
        {
          type: 'mrkdwn',
          text: `*Version Ref:* \`${input.incident.version.resolvedRef}\``,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Summary:* ${input.incident.errorMessage}`,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Root Cause Analysis (RCA):*\n${input.rcaSummary.slice(0, 1000)}`,
      },
    },
    ...(input.prUrl
      ? [
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Review Proposed Pull Request',
                  emoji: false,
                },
                url: input.prUrl,
                style: 'primary',
              },
            ],
          },
        ]
      : []),
  ];

  const fallbackText = `[Aegis] Incident Report - ${input.incident.serviceName}: ${input.incident.errorMessage}\n\n${input.rcaSummary}${input.prUrl ? `\nPR: ${input.prUrl}` : ''}`;

  // If we have a Slack channel from ingestion metadata, try sending directly to that thread/channel first
  if (channelId) {
    const sent = await sendSlackMessage(channelId, fallbackText, threadTs, blocks);
    if (sent) return true;
  }

  // Otherwise fallback to standard webhook URL
  if (!webhookUrl) {
    logger.info('[SlackNotifier] SLACK_WEBHOOK_URL not configured. Outputting RCA report to console:\n' + fallbackText);
    return false;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    });

    if (response.ok) {
      logger.info('[SlackNotifier] Sent incident notification to Slack via webhook.');
      return true;
    } else {
      logger.error(`[SlackNotifier] Slack notification failed with status: ${response.status}`);
      return false;
    }
  } catch (error: any) {
    logger.error(`[SlackNotifier] Failed to send Slack notification: ${error.message}`);
    return false;
  }
}
