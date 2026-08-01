import { app } from '@/app';
import { getConfigPort, getConfigAwsSecretsManagerSecretId, getConfigAwsSecretPollIntervalMs } from '@/config/env';
import { logger } from '@/utils/logger';
import { AccessKeyService } from '@/security/accessKeyService';

import { getAegisAsciiArt } from '@/utils/ascii';
import { getPackageMetadata } from '@/views/homePage';
import { logLockServiceInitialization } from './lock';

const PORT = getConfigPort();

app.listen(PORT, () => {
  const pkgMeta = getPackageMetadata();
  console.log(getAegisAsciiArt(pkgMeta.version), "\n");
  logger.info(`======================================================`);
  logger.info(`Server listening on   http://localhost:${PORT}`);
  logger.info(`Webhook Receiver:     http://localhost:${PORT}/api/v1/webhooks/sentry`);
  logger.info(`Health Check:         http://localhost:${PORT}/api/v1/webhooks/health`);
  logger.info(`======================================================`);

  // 1. Initialize access key authentication layer
  AccessKeyService.init();

  // 2. If AWS Secrets Manager is configured in production, start background rotation polling daemon
  const awsSecretId = getConfigAwsSecretsManagerSecretId();
  if (awsSecretId) {
    AccessKeyService.startAwsSecretRotationPolling(getConfigAwsSecretPollIntervalMs());
  }

  // 3. log lock service initialization
  logLockServiceInitialization();
});


