import { Request, Response } from 'express';
import { dbService } from '@/db/dbService';
import { ApiResponseFormatter } from '@/utils/responseFormatter';
import { logger } from '@/utils/logger';

export class JobController {
  /**
   * Retrieves real-time debugging status, RCA summary, and task history for a job ID.
   */
  static async handleGetJobStatus(req: Request, res: Response): Promise<void> {
    try {
      const jobId = String(req.params.jobId || '');
      const job = await dbService.getJobById(jobId);

      if (!job) {
        ApiResponseFormatter.error(
          res,
          `No debugging process found for job ID: ${jobId}`,
          404,
          { jobId },
          'ERR_JOB_NOT_FOUND'
        );
        return;
      }

      const jobData = {
        jobId: job.jobId,
        serviceName: job.serviceName,
        environment: job.environment,
        errorClass: job.errorClass,
        errorMessage: job.errorMessage,
        processStatus: job.status,
        prUrl: job.prUrl || null,
        rcaSummary: job.rcaSummary || null,
        workerTasksCount: job.workerTasks?.length || 0,
        workerTasks: job.workerTasks || [],
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };

      ApiResponseFormatter.success(res, jobData, 'Job status retrieved successfully', 200);
    } catch (error: any) {
      logger.error(`[JobController] Error fetching status for job ${req.params.jobId}: ${error.message}`);
      ApiResponseFormatter.error(
        res,
        'Internal server error fetching job status',
        500,
        error.message,
        'ERR_INTERNAL_SERVER'
      );
    }
  }
}
