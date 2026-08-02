import mongoose from 'mongoose';
import { JobModel, IJob, JobStatus, MessageRole, TaskStatus } from '@/db/models/job';
import { NormalizedIncident } from '@/ingestion/types';
import { LFUMemoryStore } from '@/db/lfuMemoryStore';
import { logger } from '@/utils/logger';

export class DBService {
  private memoryStore = new LFUMemoryStore<any>(500); // Max 500 jobs with LFU fan-out eviction

  private isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  /**
   * Initializes a new Job when an incident alert or Slack message arrives.
   * Uses MongoDB when connected, or fast in-memory fallback for offline simulation/testing.
   */
  async createJob(incident: NormalizedIncident, channelId?: string, threadTs?: string, userPrompt?: string): Promise<IJob> {
    const jobData = {
      jobId: incident.incidentId,
      channelId,
      threadTs,
      serviceName: incident.serviceName,
      environment: incident.environment,
      errorClass: incident.errorClass,
      errorMessage: incident.errorMessage,
      status: 'INITIATED' as JobStatus,
      version: {
        resolvedRef: incident.version.resolvedRef,
        resolutionSource: incident.version.resolutionSource,
      },
      promptMessages: userPrompt
        ? [
            {
              role: 'user' as MessageRole,
              content: userPrompt,
              timestamp: new Date(),
            },
          ]
        : [],
      workerTasks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    if (this.isConnected()) {
      const job = new JobModel(jobData);
      await job.save();
      logger.info(`[DB] Created new Job: ${job.jobId} in MongoDB`);
      return job;
    } else {
      logger.info(`[DB] MongoDB offline (readyState: ${mongoose.connection.readyState}). Storing Job ${incident.incidentId} in memory.`);
      this.memoryStore.set(incident.incidentId, jobData);
      return jobData as any;
    }
  }

  /**
   * Appends a prompt message (user, orchestrator, or worker response) to the job.
   */
  async addPromptMessage(jobId: string, role: MessageRole, content: string, workerName?: string): Promise<void> {
    if (this.isConnected()) {
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
    } else {
      const job = this.memoryStore.get(jobId);
      if (job) {
        job.promptMessages.push({ role, content, workerName, timestamp: new Date() });
      }
    }
  }

  /**
   * Records the spawning of a specialized worker subagent.
   */
  async addWorkerTask(jobId: string, taskId: string, workerType: string, inputPrompt: string): Promise<void> {
    const taskData = {
      taskId,
      workerType,
      status: 'RUNNING' as TaskStatus,
      inputPrompt,
      startedAt: new Date(),
    };

    if (this.isConnected()) {
      await JobModel.updateOne(
        { jobId },
        { $push: { workerTasks: taskData } }
      );
    } else {
      const job = this.memoryStore.get(jobId);
      if (job) {
        job.workerTasks.push(taskData);
      }
    }
    logger.info(`[DB] Spawned Subagent WorkerTask ${taskId} (${workerType}) for master entity ${jobId}`);
  }

  /**
   * Updates a worker subagent task result upon completion or failure.
   */
  async updateWorkerTaskResult(jobId: string, taskId: string, status: TaskStatus, outputResult?: string): Promise<void> {
    if (this.isConnected()) {
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
    } else {
      const job = this.memoryStore.get(jobId);
      if (job) {
        const task = job.workerTasks.find((t: any) => t.taskId === taskId);
        if (task) {
          task.status = status;
          task.outputResult = outputResult;
          task.completedAt = new Date();
        }
      }
    }
    logger.info(`[DB] Updated Subagent WorkerTask ${taskId} status: ${status}`);
  }

  /**
   * Updates top-level job status and final RCA summary.
   */
  async updateJobStatus(jobId: string, status: JobStatus, rcaSummary?: string, prUrl?: string): Promise<void> {
    if (this.isConnected()) {
      await JobModel.updateOne(
        { jobId },
        {
          $set: {
            status,
            ...(rcaSummary ? { rcaSummary } : {}),
            ...(prUrl ? { prUrl } : {}),
            updatedAt: new Date(),
          },
        }
      );
    } else {
      const job = this.memoryStore.get(jobId);
      if (job) {
        job.status = status;
        if (rcaSummary) job.rcaSummary = rcaSummary;
        if (prUrl) job.prUrl = prUrl;
        job.updatedAt = new Date();
      }
    }
  }

  /**
   * Finds a job by Slack channelId and threadTs for mid-job interactive querying.
   */
  async findJobByThreadTs(channelId: string, threadTs: string): Promise<IJob | null> {
    if (this.isConnected()) {
      return JobModel.findOne({ channelId, threadTs }).exec();
    } else {
      for (const job of this.memoryStore.values()) {
        if (job.channelId === channelId && job.threadTs === threadTs) {
          return job as any;
        }
      }
      return null;
    }
  }

  async getJobById(jobId: string): Promise<IJob | null> {
    if (this.isConnected()) {
      return JobModel.findOne({ jobId }).exec();
    } else {
      return this.memoryStore.get(jobId) || null;
    }
  }

  async getJob(jobId: string): Promise<IJob | null> {
    return this.getJobById(jobId);
  }

  /**
   * Returns the count of completed jobs/runs (status: COMPLETED or PR_CREATED).
   */
  async getCompletedJobsCount(): Promise<number> {
    if (this.isConnected()) {
      try {
        return await JobModel.countDocuments({ status: { $in: ['COMPLETED', 'PR_CREATED'] } });
      } catch {
        return 0;
      }
    } else {
      let count = 0;
      for (const job of this.memoryStore.values()) {
        if (job.status === 'COMPLETED' || job.status === 'PR_CREATED') {
          count++;
        }
      }
      return count;
    }
  }

  /**
   * Returns total count of all jobs tracked in DB or memory.
   */
  async getTotalJobsCount(): Promise<number> {
    if (this.isConnected()) {
      try {
        return await JobModel.countDocuments({});
      } catch {
        return 0;
      }
    } else {
      return this.memoryStore.size;
    }
  }
}

export const dbService = new DBService();
