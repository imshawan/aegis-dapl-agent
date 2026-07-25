import express from 'express';
import cors from 'cors';
import { webhookRouter } from '@/routes/webhookRouter';
import { jobRouter } from '@/routes/jobRouter';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { logger } from '@/utils/logger';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Mount Webhook Router
app.use('/api/v1/webhooks', webhookRouter);

// Mount Job Status API Router
app.use('/api/v1/jobs', jobRouter);
app.use('/api/v1/status', jobRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled Application Error:', err);
  ApiResponseFormatter.error(res, err.message || 'Internal Server Error', 500, err.stack, 'ERR_UNHANDLED_EXCEPTION');
});


