import { Worker, Queue } from "bullmq";
import type { ConnectionOptions } from "bullmq";
import { loadConfig, type AppConfig } from "@hermes/config";
import { getDueReminders, completeReminder } from "@hermes/actions";
import { revokeExpiredConnections, getStaleConnections } from "@hermes/google";
import { applyRetentionPolicy } from "@hermes/admin";
import { audit } from "@hermes/audit";
import { db } from "@hermes/db";
import { ObjectStorage } from "@hermes/storage";
import { createOpenAIProviders } from "@hermes/llm";
import { indexArtifactVersion, indexSSOTVersion } from "@hermes/knowledge";
import type { EmbeddingFunction } from "@hermes/knowledge";
import { structuredLogger } from "@hermes/observability";

/**
 * Hermes Worker — background job processor.
 *
 * BullMQ queues (Section 28):
 *   1. reminders                    — process due reminders, send Discord notifications
 *   2. oauth-cleanup                — revoke expired OAuth connections
 *   3. retention                    — apply retention policies (purge old data)
 *   4. action-reconcile             — reconcile OUTCOME_UNKNOWN actions
 *   5. indexing                     — index artifacts whose extracted text has no chunks
 *   6. ssot-indexing                — index SSOT versions whose indexedAt is null
 *   7. source-access-revalidation   — surface stale OAuth connections for revalidation
 *   8. memory-maintenance           — expire personal memories past their expiresAt
 *
 * Each worker is idempotent — if the job is retried, it can safely re-run.
 */

export interface WorkerConfig {
  redisUrl: string;
  concurrency?: number;
}

function parseRedisUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port, 10) || 6379,
    password: u.password || undefined,
    username: u.username || undefined,
  };
}

// -------------------------------------------------------------------------
// Queue definitions
// -------------------------------------------------------------------------
export const QUEUES = {
  reminders: "hermes:reminders",
  oauthCleanup: "hermes:oauth-cleanup",
  retention: "hermes:retention",
  actionReconcile: "hermes:action-reconcile",
  indexing: "hermes:indexing",
  ssotIndexing: "hermes:ssot-indexing",
  sourceAccessRevalidation: "hermes:source-access-revalidation",
  memoryMaintenance: "hermes:memory-maintenance",
} as const;

/**
 * Actions remaining in OUTCOME_UNKNOWN for longer than this threshold are
 * audited with ACTION_FAILED so operations can reconcile them. Configurable
 * via the ACTION_RECONCILE_STALE_HOURS environment variable.
 */
const ACTION_RECONCILE_STALE_HOURS = Number.parseInt(
  process.env.ACTION_RECONCILE_STALE_HOURS ?? "24",
  10,
);

/**
 * OAuth connections not verified within this many days are considered stale
 * and surfaced for revalidation. Configurable via the
 * STALE_CONNECTION_THRESHOLD_DAYS environment variable.
 */
const STALE_CONNECTION_THRESHOLD_DAYS = Number.parseInt(
  process.env.STALE_CONNECTION_THRESHOLD_DAYS ?? "7",
  10,
);

// -------------------------------------------------------------------------
// Embedding function
// -------------------------------------------------------------------------

/**
 * Build an {@link EmbeddingFunction} from the application config. When the
 * OpenAI API key is a placeholder (staging without real credentials), a
 * deterministic mock embedding is used — the same placeholder strategy as
 * apps/discord. Otherwise the real OpenAI embeddings provider is used.
 */
function createEmbeddingFn(cfg: AppConfig): EmbeddingFunction {
  if (cfg.openaiApiKey.startsWith("replace-with")) {
    structuredLogger.warn("embedding_mock_enabled", {
      reason: "OPENAI_API_KEY is a placeholder; using deterministic mock embedding",
    });
    return {
      async embed(text) {
        const vec = new Array(1536).fill(0);
        for (let i = 0; i < text.length; i++) {
          vec[i % 1536] = (vec[i % 1536] + text.charCodeAt(i)) / 1000;
        }
        return vec;
      },
    };
  }
  const { embedding } = createOpenAIProviders({
    apiKey: cfg.openaiApiKey,
    reasoningModel: cfg.openaiReasoningModel,
    embeddingModel: cfg.openaiEmbeddingModel,
    baseURL: cfg.openaiBaseUrl,
    llmBaseUrl: cfg.openaiLlmBaseUrl,
    embeddingBaseUrl: cfg.openaiEmbeddingBaseUrl,
    llmApiKey: cfg.openaiLlmApiKey,
    embeddingApiKey: cfg.openaiEmbeddingApiKey,
  });
  return embedding;
}

// -------------------------------------------------------------------------
// Worker processors
// -------------------------------------------------------------------------

/**
 * Process due reminders. For each due reminder, send a Discord notification
 * and mark it as completed. This job runs every minute.
 */
async function processReminders(): Promise<{ processed: number }> {
  const due = await getDueReminders();
  let processed = 0;
  for (const reminder of due) {
    try {
      // In a full implementation, this would send a Discord message.
      // For staging, we just mark it as completed and audit.
      await completeReminder(reminder.id);
      await audit({
        type: "REMINDER_TRIGGERED",
        employeeId: reminder.employeeId,
        resourceType: "Reminder",
        resourceId: reminder.id,
        metadata: { text: reminder.text },
      });
      processed++;
    } catch (err) {
      structuredLogger.error("reminder_failed", {
        reminderId: reminder.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { processed };
}

/**
 * Revoke expired OAuth connections. This job runs daily.
 */
async function processOauthCleanup(): Promise<{ revoked: number }> {
  const revoked = await revokeExpiredConnections();
  await audit({
    type: "OAUTH_CLEANUP",
    metadata: { revokedCount: revoked },
  });
  return { revoked };
}

/**
 * Apply retention policies. This job runs daily.
 */
async function processRetention(): Promise<{ policies: Record<string, number> }> {
  const policies: Record<string, number> = {};
  // Apply all configured retention policies.
  for (const key of ["conversations", "audit_events", "messages", "actions"]) {
    try {
      const count = await applyRetentionPolicy(key);
      policies[key] = count;
    } catch (err) {
      structuredLogger.error("retention_failed", {
        policy: key,
        error: err instanceof Error ? err.message : String(err),
      });
      policies[key] = -1;
    }
  }
  return { policies };
}

/**
 * Reconcile actions in OUTCOME_UNKNOWN status. This job runs every 5 minutes.
 *
 * For each OUTCOME_UNKNOWN action, the details are logged for operations
 * review (the actual provider query needs the specific provider). Actions that
 * have remained in OUTCOME_UNKNOWN for longer than the configured stale
 * threshold are audited with ACTION_FAILED so they surface for manual
 * reconciliation.
 */
async function processActionReconcile(): Promise<{ reconciled: number; audited: number }> {
  const unknownActions = await db.action.findMany({
    where: { status: "OUTCOME_UNKNOWN" },
  });

  const staleCutoff = new Date(Date.now() - ACTION_RECONCILE_STALE_HOURS * 60 * 60 * 1000);
  let audited = 0;

  for (const action of unknownActions) {
    structuredLogger.info("action_outcome_unknown", {
      actionId: action.id,
      employeeId: action.employeeId,
      type: action.type,
      provider: action.provider,
      updatedAt: action.updatedAt.toISOString(),
      awaiting: "manual reconciliation",
    });

    // Audit actions stuck in OUTCOME_UNKNOWN past the stale threshold.
    if (action.updatedAt < staleCutoff) {
      await audit({
        type: "ACTION_FAILED",
        employeeId: action.employeeId,
        resourceType: "Action",
        resourceId: action.id,
        metadata: {
          reason: "outcome_unknown_stale",
          staleHours: ACTION_RECONCILE_STALE_HOURS,
          provider: action.provider,
          actionType: action.type,
        },
      });
      audited++;
    }
  }
  return { reconciled: 0, audited };
}

/**
 * Index artifact versions that have extracted text persisted to object
 * storage but no KnowledgeChunk records yet. This job runs hourly.
 *
 * For each unindexed version, the extracted text is fetched from object
 * storage, then chunked, embedded, and persisted via
 * {@link indexArtifactVersion}.
 */
async function processIndexing(
  storage: ObjectStorage,
  bucket: string,
  embeddingFn: EmbeddingFunction,
): Promise<{ reindexed: number }> {
  // Find artifact versions that haven't been indexed yet.
  const unindexed = await db.artifactVersion.findMany({
    where: {
      extractedTextObjectKey: { not: null },
      // Check if there are no KnowledgeChunks for this version
      KnowledgeChunk: { none: {} },
    },
    take: 50,
  });

  let reindexed = 0;
  for (const version of unindexed) {
    const objectKey = version.extractedTextObjectKey;
    if (!objectKey) continue;
    try {
      const textBuffer = await storage.getObject(bucket, objectKey);
      if (!textBuffer) {
        structuredLogger.warn("indexing_text_missing", {
          artifactVersionId: version.id,
          objectKey,
        });
        continue;
      }
      const text = textBuffer.toString("utf-8");
      const chunks = await indexArtifactVersion({
        artifactVersionId: version.id,
        text,
        embeddingFn,
      });
      structuredLogger.info("indexing_complete", {
        artifactVersionId: version.id,
        chunksCreated: chunks.length,
      });
      reindexed++;
    } catch (err) {
      structuredLogger.error("indexing_failed", {
        artifactVersionId: version.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { reindexed };
}

/**
 * Index SSOT versions whose indexedAt is null. This job runs every 5 minutes.
 *
 * SSOT versions store their content inline, so no object-storage fetch is
 * needed. On success, indexedAt is stamped.
 */
async function processSSOTIndexing(embeddingFn: EmbeddingFunction): Promise<{ indexed: number }> {
  const unindexed = await db.sSOTVersion.findMany({
    where: { indexedAt: null },
    take: 50,
  });

  let indexed = 0;
  for (const version of unindexed) {
    try {
      const chunks = await indexSSOTVersion({
        ssotVersionId: version.id,
        text: version.content,
        embeddingFn,
      });
      await db.sSOTVersion.update({
        where: { id: version.id },
        data: { indexedAt: new Date() },
      });
      structuredLogger.info("ssot_indexing_complete", {
        ssotVersionId: version.id,
        chunksCreated: chunks.length,
      });
      indexed++;
    } catch (err) {
      structuredLogger.error("ssot_indexing_failed", {
        ssotVersionId: version.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { indexed };
}

/**
 * Surface stale OAuth connections for revalidation. This job runs hourly.
 *
 * For staging, stale connections are logged for operations review; full
 * revalidation requires the Google API.
 */
async function processSourceAccessRevalidation(): Promise<{ stale: number }> {
  const stale = await getStaleConnections(STALE_CONNECTION_THRESHOLD_DAYS);
  for (const connection of stale) {
    structuredLogger.info("source_access_stale", {
      connectionId: connection.id,
      employeeId: connection.employeeId,
      lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
      thresholdDays: STALE_CONNECTION_THRESHOLD_DAYS,
      awaiting: "manual revalidation",
    });
  }
  return { stale: stale.length };
}

/**
 * Expire personal memories whose expiresAt has passed. This job runs daily.
 */
async function processMemoryMaintenance(): Promise<{ expired: number }> {
  const result = await db.personalMemory.updateMany({
    where: {
      status: "ACTIVE",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  if (result.count > 0) {
    structuredLogger.info("memory_maintenance_complete", { expired: result.count });
  }
  return { expired: result.count };
}

// -------------------------------------------------------------------------
// Worker setup
// -------------------------------------------------------------------------

export async function startWorker(config: WorkerConfig): Promise<{
  workers: Worker[];
  queues: Queue[];
  close: () => Promise<void>;
}> {
  const cfg = loadConfig(process.env);
  const connection = parseRedisUrl(config.redisUrl);
  const concurrency = config.concurrency ?? 1;

  const storage = new ObjectStorage({
    endpoint: cfg.objectStorageEndpoint,
    bucket: cfg.objectStorageBucket,
    accessKey: cfg.objectStorageAccessKey,
    secretKey: cfg.objectStorageSecretKey,
  });
  const embeddingFn = createEmbeddingFn(cfg);

  const workers: Worker[] = [];
  const queues: Queue[] = [];

  // Reminders worker
  const remindersWorker = new Worker(QUEUES.reminders, async () => processReminders(), {
    connection,
    concurrency,
  });
  workers.push(remindersWorker);

  // OAuth cleanup worker
  const oauthWorker = new Worker(QUEUES.oauthCleanup, async () => processOauthCleanup(), {
    connection,
    concurrency,
  });
  workers.push(oauthWorker);

  // Retention worker
  const retentionWorker = new Worker(QUEUES.retention, async () => processRetention(), {
    connection,
    concurrency,
  });
  workers.push(retentionWorker);

  // Action reconcile worker
  const reconcileWorker = new Worker(QUEUES.actionReconcile, async () => processActionReconcile(), {
    connection,
    concurrency,
  });
  workers.push(reconcileWorker);

  // Indexing worker
  const indexingWorker = new Worker(
    QUEUES.indexing,
    async () => processIndexing(storage, cfg.objectStorageBucket, embeddingFn),
    { connection, concurrency },
  );
  workers.push(indexingWorker);

  // SSOT indexing worker
  const ssotIndexingWorker = new Worker(
    QUEUES.ssotIndexing,
    async () => processSSOTIndexing(embeddingFn),
    { connection, concurrency },
  );
  workers.push(ssotIndexingWorker);

  // Source access revalidation worker
  const sourceAccessWorker = new Worker(
    QUEUES.sourceAccessRevalidation,
    async () => processSourceAccessRevalidation(),
    { connection, concurrency },
  );
  workers.push(sourceAccessWorker);

  // Memory maintenance worker
  const memoryWorker = new Worker(
    QUEUES.memoryMaintenance,
    async () => processMemoryMaintenance(),
    { connection, concurrency },
  );
  workers.push(memoryWorker);

  // Set up repeatable job schedules with deterministic job IDs (Section 28)
  const remindersQueue = new Queue(QUEUES.reminders, { connection });
  const oauthQueue = new Queue(QUEUES.oauthCleanup, { connection });
  const retentionQueue = new Queue(QUEUES.retention, { connection });
  const reconcileQueue = new Queue(QUEUES.actionReconcile, { connection });
  const indexingQueue = new Queue(QUEUES.indexing, { connection });
  const ssotIndexingQueue = new Queue(QUEUES.ssotIndexing, { connection });
  const sourceAccessQueue = new Queue(QUEUES.sourceAccessRevalidation, { connection });
  const memoryQueue = new Queue(QUEUES.memoryMaintenance, { connection });

  queues.push(
    remindersQueue,
    oauthQueue,
    retentionQueue,
    reconcileQueue,
    indexingQueue,
    ssotIndexingQueue,
    sourceAccessQueue,
    memoryQueue,
  );

  // Schedule repeatable jobs with deterministic job IDs
  await remindersQueue.add(
    "reminders-cron",
    {},
    {
      repeat: { pattern: "* * * * *" },
      jobId: "hermes-reminders-cron",
    },
  );
  await oauthQueue.add(
    "oauth-cleanup-cron",
    {},
    {
      repeat: { pattern: "0 3 * * *" },
      jobId: "hermes-oauth-cleanup-cron",
    },
  );
  await retentionQueue.add(
    "retention-cron",
    {},
    {
      repeat: { pattern: "0 4 * * *" },
      jobId: "hermes-retention-cron",
    },
  );
  await reconcileQueue.add(
    "action-reconcile-cron",
    {},
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "hermes-action-reconcile-cron",
    },
  );
  await indexingQueue.add(
    "indexing-cron",
    {},
    {
      repeat: { pattern: "0 * * * *" },
      jobId: "hermes-indexing-cron",
    },
  );
  await ssotIndexingQueue.add(
    "ssot-indexing-cron",
    {},
    {
      repeat: { pattern: "*/5 * * * *" },
      jobId: "hermes-ssot-indexing-cron",
    },
  );
  await sourceAccessQueue.add(
    "source-access-revalidation-cron",
    {},
    {
      repeat: { pattern: "0 * * * *" },
      jobId: "hermes-source-access-revalidation-cron",
    },
  );
  await memoryQueue.add(
    "memory-maintenance-cron",
    {},
    {
      repeat: { pattern: "0 5 * * *" },
      jobId: "hermes-memory-maintenance-cron",
    },
  );

  // Log worker events
  for (const worker of workers) {
    worker.on("completed", (job, result) => {
      structuredLogger.info("job_completed", {
        queue: worker.name,
        jobId: job.id,
        result,
      });
    });
    worker.on("failed", (job, err) => {
      structuredLogger.error("job_failed", {
        queue: worker.name,
        jobId: job?.id,
        error: err.message,
      });
    });
  }

  const close = async (): Promise<void> => {
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
  };

  return { workers, queues, close };
}

// -------------------------------------------------------------------------
// Entrypoint
// -------------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  structuredLogger.info("worker_starting", { nodeEnv: cfg.nodeEnv });
  const { close } = await startWorker({ redisUrl: cfg.redisUrl });
  structuredLogger.info("worker_started", {
    message: "Hermes worker started. Press Ctrl+C to stop.",
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    structuredLogger.info("worker_shutdown", { signal: "SIGTERM" });
    await close();
    await db.$disconnect();
    process.exit(0);
  });
  process.on("SIGINT", async () => {
    structuredLogger.info("worker_shutdown", { signal: "SIGINT" });
    await close();
    await db.$disconnect();
    process.exit(0);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    structuredLogger.error("worker_fatal", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
