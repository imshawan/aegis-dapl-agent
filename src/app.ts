import express from 'express';
import cors from 'cors';
import { webhookRouter } from '@/routes/webhookRouter';
import { jobRouter } from '@/routes/jobRouter';
import { getHomePageHtml } from '@/views/homePage';
import { AccessKeyService } from '@/security/accessKeyService';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { logger } from '@/utils/logger';
import { dbService } from '@/db/dbService';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Default Server Homepage
app.get('/', async (req: express.Request, res: express.Response) => {
  const providedKey = req.query.key || req.headers['accesskey'] || req.headers['x-aegis-access-key'] || req.headers['authorization']?.replace(/^Bearer\s+/i, '');
  const isAuthorized = AccessKeyService.validateKey(providedKey as string | string[] | undefined);
  const completedJobsCount = await dbService.getCompletedJobsCount();
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(getHomePageHtml({ isAuthorized, completedJobsCount }));
});

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
