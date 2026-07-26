import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSentryPayload, parseSlackPayload, parseRawTextPayload } from '@/parsers';

describe('🧩 Aegis Multi-Source Ingestion & Modular Parsers Suite', () => {
  it('should parse Sentry APM webhook payload correctly', () => {
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

    const norm = parseSentryPayload(sentryAlert);
    assert.strictEqual(norm.incidentId, 'sentry_101');
    assert.strictEqual(norm.serviceName, 'payment-service');
    assert.strictEqual(norm.version.resolvedRef, '7f8a91b2c3d4e5f60718293a4b5c6d7e8f901a2b');
    assert.strictEqual(norm.errorClass, 'TypeError');
  });

  it('should parse Slack ingestion text payload correctly', () => {
    const slackPayload = {
      text: `service:user-service ref:v2.1.0 TypeError: Invalid DB connection string
    at connectToDatabase (src/config/database.ts:42:15)
    at handleRequest (src/server.ts:15:3)`,
    };

    const norm = parseSlackPayload(slackPayload);
    assert.strictEqual(norm.serviceName, 'user-service');
    assert.strictEqual(norm.version.resolvedRef, 'v2.1.0');
    assert.strictEqual(norm.errorClass, 'service');
    assert.strictEqual(norm.stackTrace[0]?.filePath, 'src/config/database.ts');
    assert.strictEqual(norm.stackTrace[0]?.lineNumber, 42);
  });

  it('should parse raw Python traceback string correctly', () => {
    const rawPythonTraceback = `
ZeroDivisionError: division by zero
  File "app/calculators/tax.py", line 64, in calculate_tax_rate
    rate = total_tax / line_items_count
`;

    const norm = parseRawTextPayload({
      serviceName: 'tax-calculator-service',
      commitSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d',
      stackTraceText: rawPythonTraceback,
    });

    assert.strictEqual(norm.serviceName, 'tax-calculator-service');
    assert.strictEqual(norm.errorClass, 'ZeroDivisionError');
    assert.strictEqual(norm.errorMessage, 'division by zero');
    assert.strictEqual(norm.stackTrace[0]?.filePath, 'app/calculators/tax.py');
    assert.strictEqual(norm.stackTrace[0]?.lineNumber, 64);
  });

  it('should parse universal fallback stack traces across arbitrary languages (Rust, Ruby, C/C++, PHP, C#)', () => {
    const rawMultiLangTrace = `
PanicError: thread 'main' panicked at 'index out of bounds'
  0: 0x5638e - app::main at src/main.rs:15:5
  from /app/models/user.rb:14:in 'authenticate'
  #0 0x55 in main at /home/user/app.c:45
  #1 /var/www/html/index.php(123)
  in /app/Program.cs:line 42
`;

    const norm = parseRawTextPayload({
      serviceName: 'multi-lang-service',
      stackTraceText: rawMultiLangTrace,
    });

    assert.strictEqual(norm.stackTrace.length, 5);
    assert.strictEqual(norm.stackTrace[0]?.filePath, 'src/main.rs');
    assert.strictEqual(norm.stackTrace[0]?.lineNumber, 15);
    assert.strictEqual(norm.stackTrace[1]?.filePath, '/app/models/user.rb');
    assert.strictEqual(norm.stackTrace[1]?.lineNumber, 14);
    assert.strictEqual(norm.stackTrace[2]?.filePath, '/home/user/app.c');
    assert.strictEqual(norm.stackTrace[2]?.lineNumber, 45);
    assert.strictEqual(norm.stackTrace[3]?.filePath, '/var/www/html/index.php');
    assert.strictEqual(norm.stackTrace[3]?.lineNumber, 123);
    assert.strictEqual(norm.stackTrace[4]?.filePath, '/app/Program.cs');
    assert.strictEqual(norm.stackTrace[4]?.lineNumber, 42);
  });
});
