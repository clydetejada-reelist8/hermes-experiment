export { WorkerRunner, createWorkerRunner } from "./runner.js";
export { RedisListQueue, encodeRedisCommand } from "./queue.js";
export type { JobHandler, WorkerQueue } from "./runner.js";
export { processTextArtifact, DeterministicEmbeddingFunction } from "./processing.js";
export type { QueueJob } from "./queue.js";
export type { ProcessArtifactInput } from "./processing.js";

// Queue/bootstrap wiring is intentionally separate from processors so tests can
// exercise ingestion deterministically without Redis credentials.
