import type { QueueJob, RedisListQueue } from "./queue.js";

export type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<void>;

export interface WorkerQueue {
  dequeue(queue: string, timeoutSeconds?: number): Promise<QueueJob<unknown> | null>;
  enqueue?<T>(queue: string, job: QueueJob<T>): Promise<void>;
}

export class WorkerRunner {
  constructor(
    private readonly queue: WorkerQueue,
    private readonly handlers: Record<string, JobHandler>,
  ) {}

  async runOnce(queueName: string): Promise<boolean> {
    const job = await this.queue.dequeue(queueName, 1);
    if (!job) return false;
    const handler = this.handlers[job.name];
    if (!handler) throw new Error(`worker_handler_not_found: ${job.name}`);
    try {
      await handler(job);
    } catch (error) {
      const data = job.data as { retryCount?: unknown; maxRetries?: unknown };
      const retryCount = Number.isInteger(data.retryCount) ? Number(data.retryCount) : 0;
      const maxRetries = Number.isInteger(data.maxRetries) ? Number(data.maxRetries) : 3;
      if (retryCount < maxRetries && this.queue.enqueue) {
        await this.queue.enqueue(queueName, {
          ...job,
          data: { ...data, retryCount: retryCount + 1, maxRetries },
        });
      } else {
        console.error("worker_job_failed", { jobId: job.id, jobName: job.name, retryCount, error });
      }
      throw error;
    }
    return true;
  }

  async runForever(queueName: string, signal?: { aborted: boolean }): Promise<void> {
    while (!signal?.aborted) {
      try {
        await this.runOnce(queueName);
      } catch {
        // runOnce logs and requeues retryable failures. Keep the worker alive.
      }
    }
  }
}

export function createWorkerRunner(
  queue: RedisListQueue,
  handlers: Record<string, JobHandler>,
): WorkerRunner {
  return new WorkerRunner(queue, handlers);
}
