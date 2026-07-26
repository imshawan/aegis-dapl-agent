import { Router } from 'express';
import { WebhookController } from '@/controllers/webhookController';
import { validateWebhookAccessKey } from '@/security/authMiddleware';

export const webhookRouter = Router();

// Apply validation middleware to all webhook requests (health check is exempted inside middleware)
webhookRouter.use(validateWebhookAccessKey);

// Sentry APM Webhook Receiver
webhookRouter.post('/sentry', WebhookController.handleSentryWebhook);

// Slack Events API & Slash Command Receiver
webhookRouter.post('/slack', WebhookController.handleSlackWebhook);

// Raw Text Stack Trace Ingestion
webhookRouter.post('/raw', WebhookController.handleRawTextWebhook);

// Health Check
webhookRouter.get('/health', WebhookController.handleHealthCheck);

// Status Check
webhookRouter.get('/status', WebhookController.getStats);
