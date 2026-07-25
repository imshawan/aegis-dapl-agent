import mongoose, { Schema, Document } from 'mongoose';
import { VersionResolution } from '@/ingestion/types';

export type JobStatus = 'INITIATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type MessageRole = 'user' | 'assistant' | 'orchestrator' | 'worker';
export type TaskStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface IPromptMessage {
  role: MessageRole;
  content: string;
  workerName?: string;
  timestamp: Date;
}

export interface IWorkerTask {
  taskId: string;
  workerType: string; // e.g. 'CodeScoperWorker', 'GitDiffWorker', 'PatchWorker'
  status: TaskStatus;
  inputPrompt: string;
  outputResult?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface IJob extends Document {
  jobId: string;
  channelId?: string;
  threadTs?: string;
  serviceName: string;
  environment: string;
  errorClass: string;
  errorMessage: string;
  status: JobStatus;
  version: {
    resolvedRef: string;
    resolutionSource: VersionResolution['resolutionSource'];
  };
  promptMessages: IPromptMessage[];
  workerTasks: IWorkerTask[];
  rcaSummary?: string;
  prUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PromptMessageSchema = new Schema<IPromptMessage>({
  role: { type: String, enum: ['user', 'assistant', 'orchestrator', 'worker'], required: true },
  content: { type: String, required: true },
  workerName: { type: String },
  timestamp: { type: Date, default: Date.now },
});

const WorkerTaskSchema = new Schema<IWorkerTask>({
  taskId: { type: String, required: true },
  workerType: { type: String, required: true },
  status: { type: String, enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
  inputPrompt: { type: String, required: true },
  outputResult: { type: String },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
});

const JobSchema = new Schema<IJob>(
  {
    jobId: { type: String, required: true, unique: true, index: true },
    channelId: { type: String, index: true },
    threadTs: { type: String, index: true },
    serviceName: { type: String, required: true },
    environment: { type: String, default: 'production' },
    errorClass: { type: String, required: true },
    errorMessage: { type: String, required: true },
    status: {
      type: String,
      enum: ['INITIATED', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
      default: 'INITIATED',
    },
    version: {
      resolvedRef: { type: String, required: true },
      resolutionSource: { type: String, required: true },
    },
    promptMessages: [PromptMessageSchema],
    workerTasks: [WorkerTaskSchema],
    rcaSummary: { type: String },
    prUrl: { type: String },
  },
  { timestamps: true }
);

export const JobModel = mongoose.model<IJob>('Job', JobSchema);
