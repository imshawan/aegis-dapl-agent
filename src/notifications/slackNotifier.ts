import { NormalizedIncident } from '@/ingestion/types';

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
  const webhookUrl = input.webhookUrl || process.env.SLACK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.log('ℹ️ SLACK_WEBHOOK_URL not configured. Outputting RCA report to console.');
    console.log('\n--- Aegis AI RCA Summary ---');
    console.log(input.rcaSummary);
    if (input.prUrl) console.log(`Pull Request: ${input.prUrl}`);
    console.log('----------------------------\n');
    return false;
  }

  const payload = {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🛡️ Aegis AI Incident Report - ${input.incident.serviceName}`,
          emoji: true,
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
                    text: '🔍 Review Proposed Pull Request',
                    emoji: true,
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
      console.log('✅ [Slack] Sent incident notification to Slack.');
      return true;
    } else {
      console.error(`❌ Slack notification failed with status: ${response.status}`);
      return false;
    }
  } catch (error: any) {
    console.error('❌ Failed to send Slack notification:', error.message);
    return false;
  }
}
