import { app } from '@/app';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

const PORT = env.PORT;

app.listen(PORT, () => {
  logger.info(`======================================================`);
  logger.info(`Aegis AI - Autonomous Incident Debugging Agent`);
  logger.info(`======================================================`);
  logger.info(`Server listening on http://localhost:${PORT}`);
  logger.info(`Webhook Receiver: http://localhost:${PORT}/api/v1/webhooks/sentry`);
  logger.info(`Health Check:      http://localhost:${PORT}/api/v1/webhooks/health`);
  logger.info(`======================================================`);
});


