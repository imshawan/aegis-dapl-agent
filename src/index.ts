import { app } from '@/app';
import { env } from '@/config/env';

const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🛡️ Aegis AI - Autonomous Incident Debugging Agent`);
  console.log(`======================================================`);
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
  console.log(`📥 Webhook Receiver: http://localhost:${PORT}/api/v1/webhooks/sentry`);
  console.log(`🏥 Health Check:      http://localhost:${PORT}/api/v1/webhooks/health`);
  console.log(`======================================================\n`);
});
