import { writeFile } from "node:fs/promises";
import { loadConfig } from "@hermes/config";
import { db } from "@hermes/db";
import { documentProcessingLimitsFromEnv } from "@hermes/artifacts";
import { ObjectStorage } from "@hermes/storage";
import { RedisListQueue } from "./queue.js";
import { createWorkerRunner } from "./runner.js";
import { DeterministicEmbeddingFunction, processDocumentArtifact } from "./processing.js";
import { processArtifactJob, type ArtifactIngestionJob } from "./ingestion.js";

export async function startWorker(
  signal: { aborted: boolean } = { aborted: false },
): Promise<void> {
  const config = loadConfig(process.env);
  if (!config.redisUrl) throw new Error("worker_redis_not_configured");
  if (
    !config.objectStorageEndpoint ||
    !config.objectStorageBucket ||
    !config.objectStorageAccessKey ||
    !config.objectStorageSecretKey
  ) {
    throw new Error("worker_storage_not_configured");
  }

  const storage = new ObjectStorage({
    endpoint: config.objectStorageEndpoint,
    bucket: config.objectStorageBucket,
    accessKey: config.objectStorageAccessKey,
    secretKey: config.objectStorageSecretKey,
  });
  await storage.createBucketIfNotExists(config.objectStorageBucket);

  const queue = new RedisListQueue(config.redisUrl);
  const embeddingFn = new DeterministicEmbeddingFunction();
  const limits = documentProcessingLimitsFromEnv(process.env);
  const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE ?? "/tmp/hermes-worker.heartbeat";
  const heartbeat = async () => {
    await writeFile(heartbeatFile, `${new Date().toISOString()}\n`, { mode: 0o600 });
  };

  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch((error) => console.error("worker_heartbeat_failed", error));
  }, 10_000);
  heartbeatTimer.unref();
  await heartbeat();

  const runner = createWorkerRunner(queue, {
    "artifact-ingestion": async (job) => {
      const data = job.data as ArtifactIngestionJob;
      await processArtifactJob(data, {
        storage,
        versions: {
          update: async ({ id, data: update }) => {
            await db.artifactVersion.update({ where: { id }, data: update as never });
          },
        },
        process: async (input) => processDocumentArtifact({ ...input, embeddingFn, limits }),
      });
      await heartbeat();
    },
  });

  try {
    await runner.runForever("hermes.jobs", signal);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  startWorker(controller.signal).catch((error) => {
    console.error("worker_start_failed", error);
    process.exit(1);
  });
}
