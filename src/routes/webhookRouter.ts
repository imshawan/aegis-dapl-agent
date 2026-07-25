import { Router } from 'express';
import { WebhookController } from '@/controllers/webhookController';

export const webhookRouter = Router();

// Sentry APM Webhook Receiver
webhookRouter.post('/sentry', WebhookController.handleSentryWebhook);

// Slack Events API & Slash Command Receiver
webhookRouter.post('/slack', WebhookController.handleSlackWebhook);

// Raw Text Stack Trace Ingestion
webhookRouter.post('/raw', WebhookController.handleRawTextWebhook);

// Health Check
webhookRouter.get('/health', WebhookController.handleHealthCheck);
