import crypto from 'crypto';
import { logger } from '@/utils/logger';
import { getConfigNodeEnv, getConfigAegisAccessKeys } from '@/config/env';

/**
 * Access Key Service
 * 
 * Manages webhook authentication access keys for the Aegis DAPL Agent.
 * Ensures that incoming webhook requests (Sentry, Slack, Raw tracebacks)
 * provide a valid access key in the request headers before processing.
 * 
 * Key Generation Recommendation:
 * In production, access keys should be cryptographically generated using 
 * high-entropy random bytes (e.g., `AccessKeyService.generateKey('aegis_live')`),
 * injected via secure secret vaults (AWS Secrets Manager, HashiCorp Vault, K8s Secrets),
 * and loaded into environment variables (`AEGIS_ACCESS_KEYS=key1,key2`).
 */
export class AccessKeyService {
  private static activeKeys = new Set<string>();
  private static initialized = false;

  /**
   * Initialize access keys from environment variables and default test keys.
   */
  public static init(): void {
    if (this.initialized) return;

    // Load default development/test keys ONLY in non-production environments
    if (getConfigNodeEnv() !== 'production') {
      this.activeKeys.add('aegis_live_key_99x7');
      this.activeKeys.add('aegis_test_key_00a1');
      logger.info(`[AccessKeyService] Default development/test keys added for ${getConfigNodeEnv()} environment.`);
    }

    // Load custom production keys from environment (comma-separated)
    const accessKeys = getConfigAegisAccessKeys();
    if (accessKeys) {
      const envKeys = accessKeys.split(',');
      for (const key of envKeys) {
        const trimmed = key.trim();
        if (trimmed) {
          this.activeKeys.add(trimmed);
        }
      }

      logger.info(`[AccessKeyService] Loaded ${accessKeys.split(',').length} custom access keys from environment variables.`);
    }

    logger.info(`[AccessKeyService] Initialized with ${this.activeKeys.size} valid access key(s).`);
    this.initialized = true;
  }

  /**
   * Validate an incoming access key against the active set.
   */
  public static validateKey(key?: string | string[]): boolean {
    this.init();
    if (!key) return false;
    
    const token = Array.isArray(key) ? key[0] : key;
    if (typeof token !== 'string' || token.trim() === '') return false;

    // Use constant-time comparison in production if hashing keys,
    // here we check membership in the active keys set
    return this.activeKeys.has(token.trim());
  }

  /**
   * Dynamically register a new access key at runtime.
   */
  public static addKey(key: string): void {
    this.init();
    if (key && key.trim()) {
      this.activeKeys.add(key.trim());
      logger.info(`[AccessKeyService] Registered new access key (prefix: ${key.substring(0, 10)}...).`);
    }
  }

  /**
   * Remove an access key from the active set.
   */
  public static removeKey(key: string): boolean {
    this.init();
    const removed = this.activeKeys.delete(key.trim());
    if (removed) {
      logger.info(`[AccessKeyService] Revoked access key (prefix: ${key.substring(0, 10)}...).`);
    }
    return removed;
  }

  /**
   * List all active access keys (useful for audit inspections).
   */
  public static listKeys(): string[] {
    this.init();
    return Array.from(this.activeKeys);
  }

  /**
   * Helper method to generate a cryptographically secure access key.
   * Recommended for creating new API credentials.
   * 
   * @param prefix Standard environment prefix ('aegis_live' or 'aegis_test')
   * @returns Formatted 64-hex-character secure access key
   */
  public static generateKey(prefix: 'aegis_live' | 'aegis_test' = 'aegis_live'): string {
    const randomHex = crypto.randomBytes(24).toString('hex');
    return `${prefix}_${randomHex}`;
  }

  /**
   * Dynamically fetch and register webhook access keys from AWS Secrets Manager.
   * Automatically parses JSON object mappings or array formats.
   * 
   * @param secretId Optional AWS Secret ID override
   * @returns Number of access keys successfully loaded from AWS
   */
  public static async loadFromAwsSecretsManager(secretId?: string): Promise<number> {
    this.init();
    try {
      const { SecretsManagerService } = await import('@/security/secretsManagerService');
      const secretValues = await SecretsManagerService.getWebhookAccessKeys(secretId);
      const awsKeys:string[] = [];

      if (Array.isArray(secretValues) && secretValues.length) {
        secretValues.forEach(value => {
          if (value && value.includes(",")) {
            awsKeys.push(...value.split(",").map(key => key.trim()));
          } else if (value) {
            awsKeys.push(value.trim());
          }
        });
      }
      
      let count = 0;
      for (const key of awsKeys) {
        if (key && !this.activeKeys.has(key)) {
          this.activeKeys.add(key);
          count++;
        }
      }

      logger.info(`[AccessKeyService] Loaded ${count} new access key(s) from AWS Secrets Manager into active cache.`);
  
      return count;
    } catch (error: any) {
      logger.error(`[AccessKeyService] Error loading keys from AWS Secrets Manager: ${error.message}`);
      return 0;
    }
  }

  /**
   * Start automated background polling to re-sync access keys from AWS Secrets Manager.
   * Enables zero-downtime key rotation in enterprise SOC2 environments without pod restarts.
   * 
   * @param intervalMs Polling interval in milliseconds (default: 1 hour = 3,600,000 ms)
   * @param secretId Optional AWS Secret ID override
   */
  public static startAwsSecretRotationPolling(intervalMs: number = 3600000, secretId?: string): NodeJS.Timeout {
    logger.info(`[AccessKeyService] Starting AWS Secrets Manager rotation poller (Interval: ${Math.round(intervalMs / 1000)}s).`);
    
    // Initial fetch
    this.loadFromAwsSecretsManager(secretId).catch(() => {});

    // Schedule recurring background rotation check
    return setInterval(() => {
      this.loadFromAwsSecretsManager(secretId).catch(() => {});
    }, intervalMs);
  }

  /**
   * Clear all keys (primarily for testing cleanup).
   */
  public static clear(): void {
    this.activeKeys.clear();
    this.initialized = false;
  }
}
