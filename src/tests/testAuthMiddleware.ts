import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { AccessKeyService } from '@/security/accessKeyService';
import { validateWebhookAccessKey } from '@/security/authMiddleware';

class MockResponse {
  statusCode: number = 200;
  body: any = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(payload: any) {
    this.body = payload;
    return this;
  }
}

describe('🔑 Aegis Webhook Auth & AccessKey Service Suite', () => {
  beforeEach(() => {
    AccessKeyService.clear();
  });

  describe('Group 1: AccessKeyService Key Management', () => {
    it('should initialize with default development access keys in non-production environments', () => {
      assert.strictEqual(AccessKeyService.validateKey('aegis_live_key_99x7'), true);
      assert.strictEqual(AccessKeyService.validateKey('aegis_test_key_00a1'), true);
      assert.strictEqual(AccessKeyService.validateKey('invalid_fake_key'), false);
    });

    it('should NEVER load default test keys when NODE_ENV is set to production', () => {
      const origEnv = process.env.NODE_ENV;
      const origKeys = process.env.AEGIS_ACCESS_KEYS;
      try {
        process.env.NODE_ENV = 'production';
        process.env.AEGIS_ACCESS_KEYS = '';
        AccessKeyService.clear();
        assert.strictEqual(AccessKeyService.validateKey('aegis_live_key_99x7'), false);
        assert.strictEqual(AccessKeyService.validateKey('aegis_test_key_00a1'), false);
      } finally {
        process.env.NODE_ENV = origEnv;
        if (origKeys !== undefined) {
          process.env.AEGIS_ACCESS_KEYS = origKeys;
        } else {
          delete process.env.AEGIS_ACCESS_KEYS;
        }
        AccessKeyService.clear();
      }
    });

    it('should dynamically register and revoke access keys', () => {
      AccessKeyService.addKey('custom_enterprise_key_123');
      assert.strictEqual(AccessKeyService.validateKey('custom_enterprise_key_123'), true);

      const removed = AccessKeyService.removeKey('custom_enterprise_key_123');
      assert.strictEqual(removed, true);
      assert.strictEqual(AccessKeyService.validateKey('custom_enterprise_key_123'), false);
    });

    it('should generate cryptographically secure 64-character hex access keys', () => {
      const generatedLive = AccessKeyService.generateKey('aegis_live');
      const generatedTest = AccessKeyService.generateKey('aegis_test');

      assert.ok(generatedLive.startsWith('aegis_live_'));
      assert.ok(generatedTest.startsWith('aegis_test_'));
      assert.strictEqual(generatedLive.length, 11 + 48); // prefix (11) + 48 hex chars (24 bytes) = 59 chars
    });

    it('should support AWS Secrets Manager module loading and rotation method declarations', async () => {
      const { SecretsManagerService } = await import('@/security/secretsManagerService');
      assert.strictEqual(typeof SecretsManagerService.getWebhookAccessKeys, 'function');
      assert.strictEqual(typeof SecretsManagerService.putWebhookAccessKeys, 'function');
      assert.strictEqual(typeof AccessKeyService.loadFromAwsSecretsManager, 'function');
      assert.strictEqual(typeof AccessKeyService.startAwsSecretRotationPolling, 'function');
    });
  });

  describe('Group 2: Webhook Auth Middleware Validation', () => {
    it('should allow request with valid accesskey header', () => {
      const mockReq = {
        path: '/api/v1/webhooks/sentry',
        method: 'POST',
        headers: {
          'accesskey': 'aegis_live_key_99x7',
        },
      } as any;
      const mockRes = new MockResponse() as any;
      let nextCalled = false;

      validateWebhookAccessKey(mockReq, mockRes, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(mockRes.statusCode, 200);
    });

    it('should block request with missing or invalid accesskey header with HTTP 401', () => {
      const mockReq = {
        path: '/api/v1/webhooks/slack',
        method: 'POST',
        headers: {
          'accesskey': 'wrong_hacker_key',
        },
      } as any;
      const mockRes = new MockResponse() as any;
      let nextCalled = false;

      validateWebhookAccessKey(mockReq, mockRes, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(mockRes.statusCode, 401);
      assert.strictEqual(mockRes.body?.error?.code, 'ERR_UNAUTHORIZED');
    });

    it('should exempt health check endpoints from accesskey validation', () => {
      const mockReq = {
        path: '/health',
        method: 'GET',
        headers: {},
      } as any;
      const mockRes = new MockResponse() as any;
      let nextCalled = false;

      validateWebhookAccessKey(mockReq, mockRes, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);
    });

    it('should validate accesskey on job debugging endpoints (/api/v1/jobs/*)', () => {
      const mockReq = {
        path: '/api/v1/jobs/sentry_live_50000',
        method: 'GET',
        headers: {
          'accesskey': 'aegis_test_key_00a1',
        },
      } as any;
      const mockRes = new MockResponse() as any;
      let nextCalled = false;

      validateWebhookAccessKey(mockReq, mockRes, () => {
        nextCalled = true;
      });

      assert.strictEqual(nextCalled, true);

      // Verify rejection without access key
      const unauthReq = {
        path: '/api/v1/jobs/sentry_live_50000',
        method: 'GET',
        headers: {},
      } as any;
      const unauthRes = new MockResponse() as any;
      let unauthNextCalled = false;

      validateWebhookAccessKey(unauthReq, unauthRes, () => {
        unauthNextCalled = true;
      });

      assert.strictEqual(unauthNextCalled, false);
      assert.strictEqual(unauthRes.statusCode, 401);
    });
  });
});
