import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { db } from "@hermes/db";
import {
  resolveDiscordEmployee,
  requireActiveStagingEmployee,
  IdentityDeniedError,
} from "@hermes/identity";
import { evaluateCapability } from "@hermes/policy";
import {
  isKillSwitchActive,
  isFeatureEnabled,
  activateKillSwitch,
  deactivateKillSwitch,
  setFeatureFlag,
  listFeatureFlags,
  setRetentionPolicy,
  listRetentionPolicies,
  applyRetentionPolicy,
} from "@hermes/admin";
import {
  createConversation,
  appendMessage,
  getConversationMessages,
  closeConversation,
} from "@hermes/conversations";
import { addMemory, getMemories, deleteMemory, updateMemory } from "@hermes/memory";
import {
  ingestImportedFile,
  linkDriveArtifact,
  createSubmission,
  getSubmissionsForEmployee,
  ArtifactValidationError,
} from "@hermes/artifacts";
import {
  createProposal,
  getProposal,
  getProposalsByDomain,
  approveProposal,
  rejectProposal,
  requestChanges,
  SSOTAuthorizationError,
} from "@hermes/ssot";
import {
  createAction,
  getAction,
  transitionAction,
  recordConfirmation,
  parseActionProposal,
  validateProposal,
  GmailActionExecutor,
  CalendarActionExecutor,
} from "@hermes/actions";
import {
  createOAuthState,
  consumeOAuthState,
  revokeConnection,
  getActiveConnection,
} from "@hermes/google";
import { audit } from "@hermes/audit";
import * as schemas from "./schemas.js";

export interface ServerOptions {
  internalServiceToken: string;
  tokenEncryptionKey: string;
  uploadMaxBytes: number;
  logger?: boolean;
}

/**
 * Check that an employee is active and staging-allowlisted. Returns a result
 * object so route handlers can send a 403 without try/catch boilerplate.
 */
async function assertActiveEmployee(
  employeeId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await requireActiveStagingEmployee(employeeId);
    return { ok: true };
  } catch (err) {
    if (err instanceof IdentityDeniedError) {
      return { ok: false, code: err.reason };
    }
    return { ok: false, code: "internal_error" };
  }
}

/**
 * Build the Hermes API Fastify instance. Exposed for testing via `app.inject`.
 *
 * Routes (Section 27):
 *   Health:
 *     GET /health          — unauthenticated liveness probe
 *     GET /health/live     — unauthenticated liveness probe
 *     GET /health/ready    — unauthenticated readiness probe (checks DB)
 *     GET /v1/health       — unauthenticated liveness probe (versioned)
 *
 *   Identity (Section 9):
 *     GET  /v1/identity/resolve?discordUserId=...
 *     GET  /v1/me?employeeId=...
 *
 *   OAuth (Section 12):
 *     POST   /v1/google/connect-url
 *     GET    /v1/google/oauth/callback
 *     DELETE /v1/google/connection
 *     GET    /v1/google/connection
 *
 *   Conversations (Section 8):
 *     POST /v1/conversations
 *     GET  /v1/conversations/:id/messages
 *     POST /v1/conversations/:id/messages
 *     POST /v1/conversations/:id/close
 *     PATCH /v1/conversations/:id/memory-capture
 *
 *   Ask (Section 19):
 *     POST /v1/ask
 *
 *   Artifacts (Section 29):
 *     POST /v1/artifacts/upload
 *     GET  /v1/artifacts
 *     GET  /v1/artifacts/:id
 *     POST /v1/artifacts/link/google-drive
 *     POST /v1/artifacts/:id/revalidate-access
 *     POST /v1/artifact-submissions/:id/classify
 *     POST /v1/artifact-submissions/:id/import-managed-snapshot
 *     GET  /v1/artifact-submissions/:id
 *
 *   Memory (Section 11):
 *     GET   /v1/memory
 *     POST  /v1/memory
 *     PATCH /v1/memory/:id
 *     DELETE /v1/memory/:id
 *
 *   SSOT (Section 16):
 *     POST /v1/ssot/proposals
 *     GET  /v1/ssot/proposals
 *     GET  /v1/ssot/proposals/:id
 *     POST /v1/ssot/proposals/:id/approve
 *     POST /v1/ssot/proposals/:id/reject
 *     POST /v1/ssot/proposals/:id/request-changes
 *
 *   Actions (Section 21):
 *     POST /v1/actions
 *     GET  /v1/actions/:id
 *     POST /v1/actions/:id/confirm
 *     POST /v1/actions/:id/transition
 *     POST /v1/actions/:id/execute
 *     POST /v1/actions/:id/cancel
 *
 *   Admin (Section 31):
 *     GET   /v1/admin/flags
 *     PUT   /v1/admin/flags/:key
 *     POST  /v1/admin/kill-switch/activate
 *     POST  /v1/admin/kill-switch/deactivate
 *     GET   /v1/admin/retention
 *     PUT   /v1/admin/retention/:key
 *     POST  /v1/admin/retention/:key/apply
 *     GET   /v1/admin/audit-events
 *
 * All /v1/* routes (except /v1/health and /v1/google/oauth/callback) require
 * `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`. The OAuth callback is
 * exempt because it receives browser redirects from Google; the single-use
 * state parameter is its security mechanism instead.
 * All request bodies and query params are validated with Zod schemas.
 * All routes that accept an employeeId enforce active + staging-allowlist checks.
 */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  // Internal auth guard for all /v1/* routes except /v1/health and the OAuth
  // callback (which receives browser redirects from Google and therefore
  // cannot carry the internal service token; the state parameter is the
  // security mechanism instead — it is single-use and consumed on receipt).
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/v1/")) return;
    if (url === "/v1/health") return;
    if (url === "/v1/google/oauth/callback") return;
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_authorization" });
    }
    const token = auth.slice("Bearer ".length);
    if (token !== opts.internalServiceToken) {
      return reply.code(401).send({ error: "invalid_authorization" });
    }
  });

  // -------------------------------------------------------------------------
  // Health endpoints
  // -------------------------------------------------------------------------
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: "ok", database: "ok" };
    } catch {
      return { status: "degraded", database: "error" };
    }
  });
  app.get("/v1/health", async () => ({ status: "ok" }));

  // -------------------------------------------------------------------------
  // Identity (Section 9)
  // -------------------------------------------------------------------------
  app.get("/v1/identity/resolve", async (request, reply) => {
    const parsed = schemas.IdentityResolveQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { discordUserId } = parsed.data;
    try {
      const employee = await resolveDiscordEmployee(discordUserId);
      return {
        employeeId: employee.id,
        displayName: employee.displayName,
        employmentStatus: employee.employmentStatus,
      };
    } catch (err) {
      if (err instanceof IdentityDeniedError) {
        return reply.code(403).send({ error: err.message });
      }
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.get("/v1/me", async (request, reply) => {
    const parsed = schemas.MeQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return reply.code(404).send({ error: "employee_not_found" });
    }
    return {
      employeeId: employee.id,
      displayName: employee.displayName,
      employmentStatus: employee.employmentStatus,
    };
  });

  // -------------------------------------------------------------------------
  // OAuth (Section 12)
  // -------------------------------------------------------------------------
  app.post("/v1/google/connect-url", async (request, reply) => {
    const parsed = schemas.GoogleConnectUrlBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const stateRecord = await createOAuthState({
      employeeId,
      requestedScopes: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
      key: opts.tokenEncryptionKey,
    });

    const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
    const scope =
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly";
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(stateRecord.state)}&access_type=offline&prompt=consent`;

    return { url, state: stateRecord.state };
  });

  app.get("/v1/google/oauth/callback", async (request, reply) => {
    const parsed = schemas.GoogleCallbackQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { state } = parsed.data;
    const consumed = await consumeOAuthState(state, opts.tokenEncryptionKey);
    if (!consumed) {
      return reply.code(400).send({ error: "invalid_or_expired_state" });
    }
    // Full token exchange would use the Google SDK; for staging, just consume
    // the state and return success.
    return { status: "ok" };
  });

  app.delete("/v1/google/connection", async (request, reply) => {
    const parsed = schemas.GoogleConnectionDeleteBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }
    await revokeConnection(employeeId);
    return { status: "revoked" };
  });

  app.get("/v1/google/connection", async (request, reply) => {
    const parsed = schemas.GoogleConnectionQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }
    const connection = await getActiveConnection(employeeId);
    return { connection };
  });

  // -------------------------------------------------------------------------
  // Conversations (Section 8)
  // -------------------------------------------------------------------------
  app.post("/v1/conversations", async (request, reply) => {
    const parsed = schemas.CreateConversationBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;
    if (body.initiatorEmployeeId) {
      const empCheck = await assertActiveEmployee(body.initiatorEmployeeId);
      if (!empCheck.ok) {
        return reply.code(403).send({ error: empCheck.code });
      }
    }
    const conversation = await createConversation({
      initiatorEmployeeId: body.initiatorEmployeeId,
      type: body.type,
      discordThreadId: body.discordThreadId,
      audienceClassification: body.audienceClassification,
    });
    return reply.code(201).send(conversation);
  });

  app.get("/v1/conversations/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const messages = await getConversationMessages(id);
    return { messages };
  });

  app.post("/v1/conversations/:id/messages", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.AppendMessageBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;
    if (body.employeeId) {
      const empCheck = await assertActiveEmployee(body.employeeId);
      if (!empCheck.ok) {
        return reply.code(403).send({ error: empCheck.code });
      }
    }
    const message = await appendMessage({
      conversationId: id,
      role: body.role,
      content: body.content,
      employeeId: body.employeeId,
    });
    return reply.code(201).send(message);
  });

  app.post("/v1/conversations/:id/close", async (request) => {
    const { id } = request.params as { id: string };
    const conversation = await closeConversation(id);
    return conversation;
  });

  app.patch("/v1/conversations/:id/memory-capture", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.MemoryCaptureBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { enabled } = parsed.data;
    const conversation = await db.conversation.update({
      where: { id },
      data: { memoryCaptureEnabled: enabled },
    });
    return conversation;
  });

  // -------------------------------------------------------------------------
  // Ask (Section 19)
  // -------------------------------------------------------------------------
  app.post("/v1/ask", async (request, reply) => {
    const parsed = schemas.AskBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    // Check the kill switch.
    if (await isKillSwitchActive()) {
      return reply.code(503).send({ error: "kill_switch_active" });
    }
    if (!(await isFeatureEnabled("ask_enabled"))) {
      return reply.code(503).send({ error: "ask_disabled" });
    }

    // The actual Ask orchestration is handled by the Discord app or worker.
    // This endpoint is for internal service-to-service calls.
    return reply.code(202).send({
      status: "accepted",
      conversationId: body.conversationId,
    });
  });

  // -------------------------------------------------------------------------
  // Artifacts (Section 29)
  // -------------------------------------------------------------------------
  app.post("/v1/artifacts/upload", async (request, reply) => {
    const parsed = schemas.ArtifactUploadBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.submittedByEmployeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    // Check the upload feature flag.
    if (!(await isFeatureEnabled("uploads_enabled"))) {
      return reply.code(503).send({ error: "uploads_disabled" });
    }

    // Check the ARTIFACT_UPLOAD capability.
    const capDecision = await evaluateCapability(body.submittedByEmployeeId, "ARTIFACT_UPLOAD");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    const content = Buffer.from(body.content, "base64");
    const { ObjectStorage } = await import("@hermes/storage");
    const storage = new ObjectStorage({
      endpoint: process.env.OBJECT_STORAGE_ENDPOINT ?? "",
      bucket: process.env.OBJECT_STORAGE_BUCKET ?? "",
      accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "",
      secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "",
    });

    try {
      const result = await ingestImportedFile({
        storage,
        bucket: storage.defaultBucket,
        submittedByEmployeeId: body.submittedByEmployeeId,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        content,
        sourceSystem: body.sourceSystem,
        externalId: body.externalId,
        teamId: body.teamId,
        projectId: body.projectId,
        maxBytes: opts.uploadMaxBytes,
      });

      await audit({
        type: "ARTIFACT_RECEIVED",
        employeeId: body.submittedByEmployeeId,
        resourceType: "Artifact",
        resourceId: result.artifact.id,
        metadata: { filename: body.originalFilename, mimeType: body.mimeType },
      });

      return reply.code(201).send(result);
    } catch (err) {
      if (err instanceof ArtifactValidationError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      return reply.code(500).send({ error: "internal_error" });
    }
  });

  app.get("/v1/artifacts", async (request, reply) => {
    const parsed = schemas.ArtifactsListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    if (!employeeId) {
      return { artifacts: [] };
    }
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }
    const submissions = await getSubmissionsForEmployee(employeeId);
    return { submissions };
  });

  app.get("/v1/artifacts/:id", async (request) => {
    const { id } = request.params as { id: string };
    const artifact = await db.artifact.findUnique({ where: { id } });
    return { artifact };
  });

  app.post("/v1/artifacts/link/google-drive", async (request, reply) => {
    const parsed = schemas.ArtifactLinkDriveBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.submittedByEmployeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const { artifact } = await linkDriveArtifact({
      submittedByEmployeeId: body.submittedByEmployeeId,
      driveFileId: body.driveFileId,
      canonicalUrl: body.canonicalUrl,
      mimeType: body.mimeType,
      originalFilename: body.originalFilename,
    });

    const submission = await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: body.submittedByEmployeeId,
      scope: body.scope ?? "PERSONAL",
      teamId: body.teamId,
      projectId: body.projectId,
      knowledgeStatus: "REFERENCE",
    });

    return reply.code(201).send({ artifact, submission });
  });

  app.post("/v1/artifacts/:id/revalidate-access", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.ExecuteActionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }
    // Full revalidation needs the Google API; for staging, just return ok.
    return { status: "ok", artifactId: id };
  });

  app.get("/v1/artifact-submissions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const submission = await db.artifactSubmission.findUnique({ where: { id } });
    return { submission };
  });

  app.post("/v1/artifact-submissions/:id/classify", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.ClassifySubmissionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const submission = await db.artifactSubmission.update({
      where: { id },
      data: {
        scope: body.scope,
        dataSensitivity: body.dataSensitivity,
        knowledgeStatus: body.knowledgeStatus,
      },
    });

    await audit({
      type: "ARTIFACT_CLASSIFIED",
      employeeId: body.employeeId,
      resourceType: "ArtifactSubmission",
      resourceId: id,
      metadata: {
        scope: body.scope,
        dataSensitivity: body.dataSensitivity,
        knowledgeStatus: body.knowledgeStatus,
      },
    });

    return submission;
  });

  app.post("/v1/artifact-submissions/:id/import-managed-snapshot", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.ImportManagedSnapshotBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    // Look up the source submission to get the linked artifact.
    const sourceSubmission = await db.artifactSubmission.findUnique({
      where: { id },
      include: { artifact: true },
    });
    if (!sourceSubmission || !sourceSubmission.artifact) {
      return reply.code(404).send({ error: "submission_not_found" });
    }

    const sourceArtifact = sourceSubmission.artifact;

    // Create a new IMPORTED artifact from the LINKED source.
    const importedArtifact = await db.artifact.create({
      data: {
        type: sourceArtifact.type,
        mode: "IMPORTED",
        sourceSystem: sourceArtifact.sourceSystem,
        externalId: sourceArtifact.externalId,
        canonicalUrl: sourceArtifact.canonicalUrl,
        originalFilename: sourceArtifact.originalFilename,
        mimeType: sourceArtifact.mimeType,
        syncState: "SYNCED",
      },
    });

    // Create a new submission for the imported artifact.
    const submission = await createSubmission({
      artifactId: importedArtifact.id,
      submittedByEmployeeId: body.employeeId,
      scope: body.scope,
      teamId: body.teamId,
      projectId: body.projectId,
      knowledgeStatus: body.knowledgeStatus,
      dataSensitivity: body.dataSensitivity,
    });

    return reply.code(201).send({ artifact: importedArtifact, submission });
  });

  // -------------------------------------------------------------------------
  // Memory (Section 11)
  // -------------------------------------------------------------------------
  app.get("/v1/memory", async (request, reply) => {
    const parsed = schemas.MemoryListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;
    if (!employeeId) return { memories: [] };
    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }
    const memories = await getMemories(employeeId);
    return { memories };
  });

  app.post("/v1/memory", async (request, reply) => {
    const parsed = schemas.AddMemoryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    // Check the memory feature flag.
    if (!(await isFeatureEnabled("memory_enabled"))) {
      return reply.code(503).send({ error: "memory_disabled" });
    }

    // Check the MEMORY_WRITE_OWN capability.
    const capDecision = await evaluateCapability(body.employeeId, "MEMORY_WRITE_OWN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    const memory = await addMemory({
      employeeId: body.employeeId,
      content: body.content,
      type: body.type,
      sensitivity: body.sensitivity,
    });

    if (!memory) {
      return reply.code(400).send({ error: "memory_rejected_by_policy" });
    }

    await audit({
      type: "MEMORY_CREATED",
      employeeId: body.employeeId,
      resourceType: "PersonalMemory",
      resourceId: memory.id,
    });

    return reply.code(201).send(memory);
  });

  app.patch("/v1/memory/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.UpdateMemoryBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;
    const memory = await updateMemory(id, {
      content: body.content,
      sensitivity: body.sensitivity,
      status: body.status,
    });
    return memory;
  });

  app.delete("/v1/memory/:id", async (request) => {
    const { id } = request.params as { id: string };
    await deleteMemory(id);
    return { status: "deleted" };
  });

  // -------------------------------------------------------------------------
  // SSOT (Section 16)
  // -------------------------------------------------------------------------
  app.post("/v1/ssot/proposals", async (request, reply) => {
    const parsed = schemas.CreateSsotProposalBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.proposedByEmployeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    if (!(await isFeatureEnabled("ssot_enabled"))) {
      return reply.code(503).send({ error: "ssot_disabled" });
    }

    try {
      const proposal = await createProposal({
        proposedByEmployeeId: body.proposedByEmployeeId,
        authorityDomain: body.authorityDomain,
        title: body.title,
        proposedContent: body.proposedContent,
        ssotRecordId: body.ssotRecordId,
        sourceArtifactIds: body.sourceArtifactIds,
      });
      return reply.code(201).send(proposal);
    } catch (err) {
      if (err instanceof SSOTAuthorizationError) {
        return reply.code(403).send({ error: err.reasonCode, message: err.message });
      }
      const message = err instanceof Error ? err.message : "internal_error";
      return reply.code(400).send({ error: "internal_error", message });
    }
  });

  app.get("/v1/ssot/proposals", async (request, reply) => {
    const parsed = schemas.SsotProposalsListQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { domain } = parsed.data;
    if (!domain) return { proposals: [] };
    const proposals = await getProposalsByDomain(domain);
    return { proposals };
  });

  app.get("/v1/ssot/proposals/:id", async (request) => {
    const { id } = request.params as { id: string };
    const proposal = await getProposal(id);
    return { proposal };
  });

  app.post("/v1/ssot/proposals/:id/approve", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.ApproveProposalBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.approvedByEmployeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    try {
      const result = await approveProposal({
        proposalId: id,
        approvedByEmployeeId: body.approvedByEmployeeId,
      });
      return result;
    } catch (err) {
      if (err instanceof SSOTAuthorizationError) {
        return reply.code(403).send({ error: err.reasonCode, message: err.message });
      }
      const message = err instanceof Error ? err.message : "internal_error";
      return reply.code(400).send({ error: "internal_error", message });
    }
  });

  app.post("/v1/ssot/proposals/:id/reject", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.RejectProposalBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.rejectedByEmployeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    try {
      const proposal = await rejectProposal({
        proposalId: id,
        rejectedByEmployeeId: body.rejectedByEmployeeId,
      });
      return proposal;
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal_error";
      return reply.code(400).send({ error: "internal_error", message });
    }
  });

  app.post("/v1/ssot/proposals/:id/request-changes", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.RequestChangesBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.requestedByEmployeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    try {
      const proposal = await requestChanges({
        proposalId: id,
        reviewedByEmployeeId: body.requestedByEmployeeId,
      });
      return proposal;
    } catch (err) {
      const message = err instanceof Error ? err.message : "internal_error";
      return reply.code(400).send({ error: "internal_error", message });
    }
  });

  // -------------------------------------------------------------------------
  // Actions (Section 21)
  // -------------------------------------------------------------------------
  app.post("/v1/actions", async (request, reply) => {
    const parsed = schemas.CreateActionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    try {
      const proposal = parseActionProposal({
        actionType: body.actionType,
        parameters: body.parameters,
      });
      const validation = validateProposal(proposal);
      if (!validation.valid) {
        return reply.code(400).send({ error: "invalid_proposal", errors: validation.errors });
      }

      const idempotencyKey = `${body.employeeId}-${body.actionType}-${createHash("sha256").update(JSON.stringify(body.parameters)).digest("hex").slice(0, 16)}`;

      const action = await createAction({
        employeeId: body.employeeId,
        conversationId: body.conversationId,
        type: proposal.actionType,
        riskLevel: proposal.riskLevel,
        parametersJson: proposal.parameters,
        idempotencyKey,
        confirmationRequired: proposal.confirmationRequired,
      });

      await audit({
        type: "ACTION_PREPARED",
        employeeId: body.employeeId,
        resourceType: "Action",
        resourceId: action.id,
        metadata: { actionType: proposal.actionType, riskLevel: proposal.riskLevel },
      });

      return reply.code(201).send(action);
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "internal_error",
      });
    }
  });

  app.get("/v1/actions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const action = await getAction(id);
    return { action };
  });

  app.post("/v1/actions/:id/confirm", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.ConfirmActionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;

    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const action = await getAction(id);
    if (!action) {
      return reply.code(404).send({ error: "action_not_found" });
    }

    await recordConfirmation(id, employeeId, action.parametersJson as Record<string, unknown>);

    await audit({
      type: "ACTION_CONFIRMED",
      employeeId,
      resourceType: "Action",
      resourceId: id,
    });

    return { status: "confirmed" };
  });

  app.post("/v1/actions/:id/transition", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.TransitionActionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { newStatus } = parsed.data;

    try {
      const action = await transitionAction(id, newStatus);
      return action;
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "internal_error",
      });
    }
  });

  app.post("/v1/actions/:id/execute", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.ExecuteActionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;

    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const action = await getAction(id);
    if (!action) {
      return reply.code(404).send({ error: "action_not_found" });
    }

    // Transition to EXECUTING if not already in that state.
    if (action.status !== "EXECUTING") {
      try {
        await transitionAction(id, "EXECUTING");
      } catch (err) {
        return reply.code(400).send({
          error: err instanceof Error ? err.message : "invalid_transition",
        });
      }
    }

    // Execute based on action type using mock providers for staging.
    const mockGmailProvider = {
      async createDraft() {
        return { draftId: "mock-draft" };
      },
      async updateDraft() {
        return { draftId: "mock-draft" };
      },
      async sendDraft() {
        return { messageId: "mock-message" };
      },
    };
    const mockCalendarProvider = {
      async queryFreeBusy() {
        return { busySlots: [] };
      },
      async createEvent() {
        return { eventId: "mock-event" };
      },
      async updateEvent() {
        return { eventId: "mock-event" };
      },
      async cancelEvent() {
        return { cancelled: true };
      },
    };

    try {
      if (action.type.startsWith("GMAIL_")) {
        const executor = new GmailActionExecutor(mockGmailProvider);
        if (action.type === "GMAIL_SEND_DRAFT") {
          const result = await executor.executeSend(id);
          return result;
        }
        // For non-send Gmail actions, transition to SUCCEEDED (mock).
        const result = await transitionAction(id, "SUCCEEDED", {
          externalResourceId: "mock-draft",
        });
        return result;
      } else if (action.type.startsWith("CALENDAR_")) {
        const executor = new CalendarActionExecutor(mockCalendarProvider);
        if (action.type === "CALENDAR_CREATE_MEETING") {
          const result = await executor.executeCreateMeeting(id);
          return result;
        } else if (action.type === "CALENDAR_UPDATE_EVENT") {
          const result = await executor.executeUpdateEvent(id);
          return result;
        } else if (action.type === "CALENDAR_CANCEL_EVENT") {
          const result = await executor.executeCancelEvent(id);
          return result;
        }
        // For read-only / personal calendar actions, transition to SUCCEEDED (mock).
        const result = await transitionAction(id, "SUCCEEDED", {
          externalResourceId: "mock-event",
        });
        return result;
      } else {
        // Reminder and other action types — mock success.
        const result = await transitionAction(id, "SUCCEEDED");
        return result;
      }
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "execution_failed",
      });
    }
  });

  app.post("/v1/actions/:id/cancel", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = schemas.CancelActionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId } = parsed.data;

    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    try {
      const action = await transitionAction(id, "CANCELLED");
      return action;
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "internal_error",
      });
    }
  });

  // -------------------------------------------------------------------------
  // Admin (Section 31)
  // -------------------------------------------------------------------------
  app.get("/v1/admin/flags", async (request, reply) => {
    const parsed = schemas.AdminFlagsGetQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { updatedBy } = parsed.data;

    // Check HERMES_ADMIN capability.
    const capDecision = await evaluateCapability(updatedBy, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    const flags = await listFeatureFlags();
    return { flags };
  });

  app.put("/v1/admin/flags/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const parsed = schemas.SetFlagBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.updatedBy);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    // Check HERMES_ADMIN capability.
    const capDecision = await evaluateCapability(body.updatedBy, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    const flag = await setFeatureFlag(key, body.enabled, body.updatedBy);

    await audit({
      type: "FEATURE_FLAG_CHANGED",
      employeeId: body.updatedBy,
      resourceType: "FeatureFlag",
      resourceId: key,
      metadata: { enabled: body.enabled },
    });

    return flag;
  });

  app.post("/v1/admin/kill-switch/activate", async (request, reply) => {
    const parsed = schemas.KillSwitchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { updatedBy } = parsed.data;

    const empCheck = await assertActiveEmployee(updatedBy);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const capDecision = await evaluateCapability(updatedBy, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    await activateKillSwitch(updatedBy);
    await audit({
      type: "FEATURE_FLAG_CHANGED",
      employeeId: updatedBy,
      resourceType: "FeatureFlag",
      resourceId: "kill_switch.global",
      metadata: { enabled: true },
    });
    return { status: "activated" };
  });

  app.post("/v1/admin/kill-switch/deactivate", async (request, reply) => {
    const parsed = schemas.KillSwitchBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { updatedBy } = parsed.data;

    const empCheck = await assertActiveEmployee(updatedBy);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const capDecision = await evaluateCapability(updatedBy, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    await deactivateKillSwitch(updatedBy);
    await audit({
      type: "FEATURE_FLAG_CHANGED",
      employeeId: updatedBy,
      resourceType: "FeatureFlag",
      resourceId: "kill_switch.global",
      metadata: { enabled: false },
    });
    return { status: "deactivated" };
  });

  app.get("/v1/admin/retention", async () => {
    const policies = await listRetentionPolicies();
    return { policies };
  });

  app.put("/v1/admin/retention/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const parsed = schemas.SetRetentionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const body = parsed.data;

    const empCheck = await assertActiveEmployee(body.updatedBy);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const capDecision = await evaluateCapability(body.updatedBy, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    const policy = await setRetentionPolicy(key, body.retentionDays, body.updatedBy);
    return policy;
  });

  app.post("/v1/admin/retention/:key/apply", async (request, reply) => {
    const { key } = request.params as { key: string };
    const parsed = schemas.ApplyRetentionBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { updatedBy } = parsed.data;

    const empCheck = await assertActiveEmployee(updatedBy);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    const capDecision = await evaluateCapability(updatedBy, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    try {
      const count = await applyRetentionPolicy(key);
      await audit({
        type: "RETENTION_APPLIED",
        employeeId: updatedBy,
        resourceType: "RetentionPolicy",
        resourceId: key,
        metadata: { deletedCount: count },
      });
      return { key, deletedCount: count };
    } catch (err) {
      return reply.code(400).send({
        error: err instanceof Error ? err.message : "internal_error",
      });
    }
  });

  app.get("/v1/admin/audit-events", async (request, reply) => {
    const parsed = schemas.AdminAuditEventsQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "validation_error", details: parsed.error.issues });
    }
    const { employeeId, limit, offset } = parsed.data;

    const empCheck = await assertActiveEmployee(employeeId);
    if (!empCheck.ok) {
      return reply.code(403).send({ error: empCheck.code });
    }

    // Check HERMES_ADMIN capability.
    const capDecision = await evaluateCapability(employeeId, "HERMES_ADMIN");
    if (!capDecision.allowed) {
      return reply.code(403).send({ error: capDecision.reasonCode });
    }

    const events = await db.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit ?? 100,
      skip: offset ?? 0,
    });
    return { events };
  });

  return app;
}

async function start(): Promise<void> {
  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  const app = await buildServer({
    internalServiceToken: cfg.internalServiceToken,
    tokenEncryptionKey: cfg.tokenEncryptionKey,
    uploadMaxBytes: cfg.uploadMaxBytes,
    logger: true,
  });
  await app.listen({ port: cfg.apiPort, host: "0.0.0.0" });
}

// Start when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
