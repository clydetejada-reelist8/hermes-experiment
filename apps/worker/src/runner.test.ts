import { describe, expect, it } from "vitest";
import { WorkerRunner } from "./runner.js";
import type { QueueJob } from "./queue.js";

describe("WorkerRunner", () => {
  it("dispatches a queued job to the named handler", async () => {
    const processed: string[] = [];
    const runner = new WorkerRunner(
      {
        dequeue: async () => ({
          id: "job-1",
          name: "artifact-ingestion",
          data: { versionId: "v1" },
        }),
      },
      {
        "artifact-ingestion": async (job) => {
          processed.push(String((job.data as { versionId: string }).versionId));
        },
      },
    );

    await expect(runner.runOnce("hermes.jobs")).resolves.toBe(true);
    expect(processed).toEqual(["v1"]);
  });

  it("re-enqueues a failed job until its retry limit", async () => {
    const requeued: QueueJob<unknown>[] = [];
    const runner = new WorkerRunner(
      {
        dequeue: async () => ({
          id: "job-1",
          name: "artifact-ingestion",
          data: { retryCount: 0, maxRetries: 2 },
        }),
        enqueue: async (_queue, job) => {
          requeued.push(job);
        },
      },
      {
        "artifact-ingestion": async () => {
          throw new Error("temporary_failure");
        },
      },
    );

    await expect(runner.runOnce("hermes.jobs")).rejects.toThrow("temporary_failure");
    expect(requeued).toEqual([
      { id: "job-1", name: "artifact-ingestion", data: { retryCount: 1, maxRetries: 2 } },
    ]);
  });
});
