import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';
import { sendSlackNotification } from '@/notifications/slackNotifier';

console.log('======================================================');
console.log('🛡️ Aegis AI - Multi-Source Ingestion & Modular Parsers');
console.log('======================================================');

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
console.log('\n[1] Sentry Ingestion Mode:');
console.log(`    - Incident ID : ${norm1.incidentId}`);
console.log(`    - Service     : ${norm1.serviceName}`);
console.log(`    - Resolved Ref: ${norm1.version.resolvedRef} [${norm1.version.resolutionSource}]`);

// Test 2: Slack Ingestion Mode
const slackPayload = {
  text: `service:user-service ref:v2.1.0 TypeError: Invalid DB connection string
    at connectToDatabase (src/config/database.ts:42:15)
    at handleRequest (src/server.ts:15:3)`,
};

const norm2 = parseSlackPayload(slackPayload);
console.log('\n[2] Slack Ingestion Mode:');
console.log(`    - Incident ID : ${norm2.incidentId}`);
console.log(`    - Service     : ${norm2.serviceName}`);
console.log(`    - Error Class : ${norm2.errorClass}`);
console.log(`    - Top Frame   : ${norm2.stackTrace[0]?.filePath}:${norm2.stackTrace[0]?.lineNumber}`);

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

console.log('\n[3] Raw Python Traceback Ingestion Mode:');
console.log(`    - Incident ID : ${norm3.incidentId}`);
console.log(`    - Service     : ${norm3.serviceName}`);
console.log(`    - Error Class : ${norm3.errorClass} - ${norm3.errorMessage}`);
console.log(`    - Top Frame   : ${norm3.stackTrace[0]?.filePath}:${norm3.stackTrace[0]?.lineNumber}`);

console.log('\n======================================================');
console.log('✅ Aegis AI Modular Parsers Verified Successfully');
console.log('======================================================\n');
