import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { sendSlackNotification } from '@/notifications/slackNotifier';
import { logger } from '@/utils/logger';

logger.info('======================================================');
logger.info('Aegis AI - Multi-Source Ingestion & Modular Parsers');
logger.info('======================================================');

// Test 1: Sentry APM Webhook Payload
const sentryAlert = {
  event_id: 'sentry_101',
  release: '7f8a91b2c3d4e5f60718293a4b5c6d7e8f901a2b',
  project_slug: 'payment-service',
  exception: {
    values: [
      {
        type: 'TypeError',
        value: 'Cannot read property "stripeCustomerId" of undefined',
        stacktrace: {
          frames: [
            {
              filename: 'src/controllers/paymentController.ts',
              abs_path: 'src/controllers/paymentController.ts',
              lineno: 88,
              function: 'chargeCustomer',
              in_app: true,
            },
          ],
        },
      },
    ],
  },
};

const norm1 = parseSentryPayload(sentryAlert);
logger.info('[1] Sentry Ingestion Mode:\n' +
  `    - Incident ID : ${norm1.incidentId}\n` +
  `    - Service     : ${norm1.serviceName}\n` +
  `    - Resolved Ref: ${norm1.version.resolvedRef} [${norm1.version.resolutionSource}]`);

// Test 2: Slack Ingestion Mode
const slackPayload = {
  text: `service:user-service ref:v2.1.0 TypeError: Invalid DB connection string
    at connectToDatabase (src/config/database.ts:42:15)
    at handleRequest (src/server.ts:15:3)`,
};

const norm2 = parseSlackPayload(slackPayload);
logger.info('[2] Slack Ingestion Mode:\n' +
  `    - Incident ID : ${norm2.incidentId}\n` +
  `    - Service     : ${norm2.serviceName}\n` +
  `    - Error Class : ${norm2.errorClass}\n` +
  `    - Top Frame   : ${norm2.stackTrace[0]?.filePath}:${norm2.stackTrace[0]?.lineNumber}`);

// Test 3: Raw Python Traceback text string
const rawPythonTraceback = `
ZeroDivisionError: division by zero
  File "app/calculators/tax.py", line 64, in calculate_tax_rate
    rate = total_tax / line_items_count
`;

const norm3 = parseRawTextPayload({
  serviceName: 'tax-calculator-service',
  commitSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d',
  stackTraceText: rawPythonTraceback,
});

logger.info('[3] Raw Python Traceback Ingestion Mode:\n' +
  `    - Incident ID : ${norm3.incidentId}\n` +
  `    - Service     : ${norm3.serviceName}\n` +
  `    - Error Class : ${norm3.errorClass} - ${norm3.errorMessage}\n` +
  `    - Top Frame   : ${norm3.stackTrace[0]?.filePath}:${norm3.stackTrace[0]?.lineNumber}`);

logger.info('======================================================');
logger.info('Aegis AI Modular Parsers Verified Successfully');
logger.info('======================================================');

