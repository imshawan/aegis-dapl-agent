import { app } from '@/app';
import { getConfigPort } from '@/config/env';
import { logger } from '@/utils/logger';

const PORT = getConfigPort();

app.listen(PORT, () => {
  logger.info(`======================================================`);
  logger.info(`Aegis - Autonomous Incident Debugging Agent`);
  logger.info(`======================================================`);
  logger.info(`Server listening on http://localhost:${PORT}`);
  logger.info(`Webhook Receiver: http://localhost:${PORT}/api/v1/webhooks/sentry`);
  logger.info(`Health Check:      http://localhost:${PORT}/api/v1/webhooks/health`);
  logger.info(`======================================================`);
});


