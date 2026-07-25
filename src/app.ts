import express from 'express';
import cors from 'cors';
import { webhookRouter } from '@/ingestion/webhookRouter';
import { logger } from '@/utils/logger';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Mount Webhook Router
app.use('/api/v1/webhooks', webhookRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled Application Error:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

