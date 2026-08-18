import type { QueueJob, RedisListQueue } from "./queue.js";

export type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<void>;

export interface WorkerQueue {
  dequeue(queue: string, timeoutSeconds?: number): Promise<QueueJob<unknown> | null>;
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
    await handler(job);
    return true;
  }

  async runForever(queueName: string, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) await this.runOnce(queueName);
  }
}

export function createWorkerRunner(
  queue: RedisListQueue,
  handlers: Record<string, JobHandler>,
): WorkerRunner {
  return new WorkerRunner(queue, handlers);
}
