import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { logger } from '@/utils/logger';
import { getConfigAwsRegion, getConfigAwsSecretsManagerSecretId } from '@/config/env';

/**
 * AWS Secrets Manager Integration Service
 * 
 * Securely retrieves, caches, and rotates webhook access keys from AWS Secrets Manager
 * in enterprise production environments. Prevents storing plaintext tokens in files
 * or environment variables.
 */
export class SecretsManagerService {
  private static client: SecretsManagerClient | null = null;

  /**
   * Get or initialize the singleton AWS Secrets Manager client.
   */
  private static getClient(): SecretsManagerClient {
    if (!this.client) {
      this.client = new SecretsManagerClient({
        region: getConfigAwsRegion() || 'us-east-1',
      });
    }
    return this.client;
  }

  /**
   * Retrieve webhook access keys from AWS Secrets Manager.
   * Supports both JSON-formatted secrets (e.g. `{"sentry": "key1", "slack": "key2"}`)
   * and plain comma-separated strings (`key1,key2`).
   * 
   * @param secretId AWS Secret Name or ARN (defaults to env var or 'aegis/production/webhook-keys')
   * @returns Array of valid access key strings
   */
  public static async getWebhookAccessKeys(secretId?: string): Promise<string[]> {
    const targetSecretId = secretId || getConfigAwsSecretsManagerSecretId() || 'aegis/production/webhook-keys';
    
    try {
      const client = this.getClient();
      const command = new GetSecretValueCommand({ SecretId: targetSecretId });
      const response = await client.send(command);

      if (!response.SecretString) {
        logger.warn(`[SecretsManagerService] Secret '${targetSecretId}' is empty or not text-formatted.`);
        return [];
      }

      const secretText = response.SecretString.trim();
      const extractedKeys: string[] = [];

      // Attempt JSON parsing (standard AWS Secrets Manager format for key-value pairs)
      try {
        const parsed = JSON.parse(secretText);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === 'string' && item.trim()) extractedKeys.push(item.trim());
          }
        } else if (typeof parsed === 'object' && parsed !== null) {
          for (const val of Object.values(parsed)) {
            if (typeof val === 'string' && val.trim()) extractedKeys.push(val.trim());
          }
        }
      } catch {
        // Fallback: treat as comma-separated or newline-separated plain string
        const tokens = secretText.split(/[\r\n,]+/);
        for (const token of tokens) {
          const trimmed = token.trim();
          if (trimmed) extractedKeys.push(trimmed);
        }
      }

      logger.info(`[SecretsManagerService] Retrieved ${extractedKeys.length} access key(s) from AWS Secrets Manager (${targetSecretId}).`);
      return extractedKeys;
    } catch (error: any) {
      logger.error(`[SecretsManagerService] Failed to retrieve secrets from AWS Secrets Manager (${targetSecretId}): ${error.message}`);
      throw error;
    }
  }

  /**
   * Update or rotate webhook access keys in AWS Secrets Manager.
   * Useful for automated 90-day key rotation pipelines.
   * 
   * @param secretId AWS Secret Name or ARN
   * @param keys Key-value mapping of service names to secret tokens, or array of tokens
   */
  public static async putWebhookAccessKeys(secretId: string, keys: Record<string, string> | string[]): Promise<boolean> {
    try {
      const client = this.getClient();
      const secretString = JSON.stringify(keys, null, 2);
      
      const command = new PutSecretValueCommand({
        SecretId: secretId,
        SecretString: secretString,
      });

      await client.send(command);
      logger.info(`[SecretsManagerService] Successfully updated access keys in AWS Secrets Manager (${secretId}).`);
      return true;
    } catch (error: any) {
      logger.error(`[SecretsManagerService] Failed to update secrets in AWS Secrets Manager (${secretId}): ${error.message}`);
      return false;
    }
  }
}
