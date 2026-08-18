import { describe, expect, it } from "vitest";
import { WorkerRunner } from "./runner.js";

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

  it("fails closed when no handler exists", async () => {
    const runner = new WorkerRunner(
      { dequeue: async () => ({ id: "job-1", name: "unknown", data: {} }) },
      {},
    );
    await expect(runner.runOnce("hermes.jobs")).rejects.toThrow("worker_handler_not_found");
  });
});
