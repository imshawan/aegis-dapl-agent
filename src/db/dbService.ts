import { JobModel, IJob, JobStatus, MessageRole, TaskStatus } from '@/db/models/job';
import { NormalizedIncident } from '@/ingestion/types';
import { logger } from '@/utils/logger';

export class DBService {
  /**
   * Initializes a new Job in MongoDB when an incident alert or Slack message arrives.
   */
  async createJob(incident: NormalizedIncident, channelId?: string, threadTs?: string, userPrompt?: string): Promise<IJob> {
    const job = new JobModel({
      jobId: incident.incidentId,
      channelId,
      threadTs,
      serviceName: incident.serviceName,
      environment: incident.environment,
      errorClass: incident.errorClass,
      errorMessage: incident.errorMessage,
      status: 'INITIATED',
      version: {
        resolvedRef: incident.version.resolvedRef,
        resolutionSource: incident.version.resolutionSource,
      },
      promptMessages: userPrompt
        ? [
            {
              role: 'user',
              content: userPrompt,
              timestamp: new Date(),
            },
          ]
        : [],
      workerTasks: [],
    });

    await job.save();
    logger.info(`[DB] Created new Job: ${job.jobId} in MongoDB`);
    return job;
  }

  /**
   * Appends a prompt message (user, orchestrator, or worker response) to the job.
   */
  async addPromptMessage(jobId: string, role: MessageRole, content: string, workerName?: string): Promise<void> {
    await JobModel.updateOne(
      { jobId },
      {
        $push: {
          promptMessages: {
            role,
            content,
            workerName,
            timestamp: new Date(),
          },
        },
      }
    );
  }

  /**
   * Records the spawning of a specialized worker subagent.
   */
  async addWorkerTask(jobId: string, taskId: string, workerType: string, inputPrompt: string): Promise<void> {
    await JobModel.updateOne(
      { jobId },
      {
        $push: {
          workerTasks: {
            taskId,
            workerType,
            status: 'RUNNING',
            inputPrompt,
            startedAt: new Date(),
          },
        },
      }
    );
    logger.info(`[DB] Spawned Subagent WorkerTask ${taskId} (${workerType}) for Job ${jobId}`);
  }

  /**
   * Updates a worker subagent task result upon completion or failure.
   */
  async updateWorkerTaskResult(jobId: string, taskId: string, status: TaskStatus, outputResult?: string): Promise<void> {
    await JobModel.updateOne(
      { jobId, 'workerTasks.taskId': taskId },
      {
        $set: {
          'workerTasks.$.status': status,
          'workerTasks.$.outputResult': outputResult,
          'workerTasks.$.completedAt': new Date(),
        },
      }
    );
    logger.info(`[DB] Updated Subagent WorkerTask ${taskId} status: ${status}`);
  }

  /**
   * Updates top-level job status and final RCA summary.
   */
  async updateJobStatus(jobId: string, status: JobStatus, rcaSummary?: string, prUrl?: string): Promise<void> {
    await JobModel.updateOne(
      { jobId },
      {
        $set: {
          status,
          ...(rcaSummary ? { rcaSummary } : {}),
          ...(prUrl ? { prUrl } : {}),
        },
      }
    );
  }

  /**
   * Finds a job by Slack channelId and threadTs for mid-job interactive querying.
   */
  async findJobByThreadTs(channelId: string, threadTs: string): Promise<IJob | null> {
    return JobModel.findOne({ channelId, threadTs }).exec();
  }

  async getJobById(jobId: string): Promise<IJob | null> {
    return JobModel.findOne({ jobId }).exec();
  }
}

export const dbService = new DBService();
