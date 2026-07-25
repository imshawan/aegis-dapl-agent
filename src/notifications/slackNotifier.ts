import { NormalizedIncident } from '@/ingestion/types';
import { logger } from '@/utils/logger';
import { getConfigSlackWebhookUrl } from '@/config/env';

export interface SlackNotificationInput {
  incident: NormalizedIncident;
  rcaSummary: string;
  prUrl?: string;
  webhookUrl?: string;
}

/**
 * Sends a rich Slack Block Kit notification containing the Aegis RCA summary and PR link.
 */
export async function sendSlackNotification(input: SlackNotificationInput): Promise<boolean> {
  const webhookUrl = input.webhookUrl || getConfigSlackWebhookUrl();
  
  if (!webhookUrl) {
    logger.info('[SlackNotifier] SLACK_WEBHOOK_URL not configured. Outputting RCA report to console:\n' + input.rcaSummary + (input.prUrl ? `\nPull Request: ${input.prUrl}` : ''));
    return false;
  }

  const payload = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `[Aegis AI] Incident Report - ${input.incident.serviceName}`,
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
    ],
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      logger.info('[SlackNotifier] Sent incident notification to Slack.');
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
