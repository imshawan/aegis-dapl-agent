import { parseSentryPayload } from '@/parsers';
import { orchestratorAgent } from '@/agent/orchestrator';
import { handleMidJobSlackQuery } from '@/notifications/slackQueryRouter';
import { logger } from '@/utils/logger';

logger.info('======================================================');
logger.info('Aegis - Orchestrator, Subagent Workers & MongoDB Test');
logger.info('======================================================');

async function testOrchestratorArchitecture() {
  const sentryPayload = {
    event_id: `aegis_orch_${Date.now()}`,
    release: '7f8a91b2c3d4e5f60718293a4b5c6d7e8f901a2b',
    project_slug: 'payment-service',
    environment: 'production',
    exception: {
      values: [
        {
          type: 'NullPointerException',
          value: 'Customer account object is null in chargeCustomer',
          stacktrace: {
            frames: [
              {
                filename: 'src/controllers/paymentController.ts',
                abs_path: 'src/controllers/paymentController.ts',
                lineno: 142,
                function: 'chargeCustomer',
                in_app: true,
              },
            ],
          },
        },
      ],
    },
  };

  const incident = parseSentryPayload(sentryPayload);
  const channelId = 'C1234567890';
  const threadTs = '1784959000.000100';

  logger.info('[1] Starting Orchestrator Workflow with Subagent Tasks...');
  const userPrompt = 'Hey Aegis, can you look at this null pointer exception in payment-service?';

  // Run Orchestrator
  const rcaReport = await orchestratorAgent.handleIncident(incident, channelId, threadTs, userPrompt);

  logger.info('[2] Synthesized RCA Output:\n' + rcaReport.slice(0, 300) + '...\n');

  logger.info('[3] Simulating Mid-Job Interactive Slack Query (Non-blocking):');
  const queryResult = await handleMidJobSlackQuery({
    channelId,
    threadTs,
    userQuestion: 'Hey Aegis, what files did your workers inspect so far?',
  });

  logger.info('[4] Slack Query Response:\n' + queryResult);

  logger.info('======================================================');
  logger.info('Aegis Orchestrator & MongoDB Test Complete');
  logger.info('======================================================');
  process.exit(0);
}

testOrchestratorArchitecture();

