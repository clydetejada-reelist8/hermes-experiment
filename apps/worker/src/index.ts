export { WorkerRunner, createWorkerRunner } from "./runner.js";
export { RedisListQueue, encodeRedisCommand } from "./queue.js";
export type { JobHandler, WorkerQueue } from "./runner.js";
export {
  processTextArtifact,
  processDocumentArtifact,
  DeterministicEmbeddingFunction,
} from "./processing.js";
export type { QueueJob } from "./queue.js";
export type { ProcessArtifactInput } from "./processing.js";
export type { ProcessArtifactResult } from "./processing.js";
export { processArtifactJob } from "./ingestion.js";
export type { ArtifactIngestionJob } from "./ingestion.js";

// Queue/bootstrap wiring is intentionally separate from processors so tests can
// exercise ingestion deterministically without Redis credentials.
