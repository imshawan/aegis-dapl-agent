import { Router } from 'express';
import { JobController } from '@/controllers/jobController';

export const jobRouter = Router();

// Retrieve real-time debugging status and task logs by Job ID
jobRouter.get('/:jobId', JobController.handleGetJobStatus);
