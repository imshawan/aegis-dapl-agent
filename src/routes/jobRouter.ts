import { Router } from 'express';
import { JobController } from '@/controllers/jobController';
import { validateWebhookAccessKey } from '@/security/authMiddleware';

export const jobRouter = Router();

// Apply webhook access key validation to all job endpoints
jobRouter.use(validateWebhookAccessKey);

// Retrieve real-time debugging status and task logs by Job ID
jobRouter.get('/:jobId', JobController.handleGetJobStatus);
