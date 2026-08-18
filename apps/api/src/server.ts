import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  CalendarActionExecutor,
  GmailActionExecutor,
  cancelReminder,
  completeReminder,
  createReminder,
  getRemindersForEmployee,
  getAction as getStoredAction,
  parseActionProposal,
  transitionAction,
  validateProposal,
} from "@hermes/actions";
import { db } from "@hermes/db";
import { classifySubmission, createSubmission, ingestImportedFile } from "@hermes/artifacts";
import type {
  ArtifactScope,
  KnowledgeStatus,
  MemorySensitivity,
  MemoryStatus,
  MemoryType,
} from "@hermes/contracts";
import { evaluateCapability } from "@hermes/policy";
import { resolveDiscordEmployee, type Employee } from "@hermes/identity";
import { IdentityDeniedError } from "@hermes/identity";
import {
  GoogleCalendarProvider,
  GoogleGmailProvider,
  GoogleOAuthAccessTokenSource,
  buildGoogleAuthorizationUrl,
  createOAuthState,
  consumeOAuthState,
  encryptToken,
  getActiveConnection,
  revokeConnection,
  saveConnection,
} from "@hermes/google";
import { ObjectStorage } from "@hermes/storage";
import {
  addMemory,
  deleteMemory as deletePersonalMemory,
  getMemories,
  updateMemory as updatePersonalMemory,
} from "@hermes/memory";
import {
  approveProposalAsReviewer,
  createProposal,
  getReviewQueueForEmployee,
  rejectProposalAsReviewer,
  requestChangesAsReviewer,
  getSSOTDocumentForEmployee,
  type ReviewActionResult,
  type ReviewQueueProposal,
  type SSOTDocument,
} from "@hermes/ssot";
import { searchVisibleKnowledge, type SearchEvidence, type SearchInput } from "./search.js";

export interface ResolvedIdentity {
  id: string;
  employeeCode: string;
  displayName: string;
  discordUserId: string;
}

export type UploadDestination =
  "FOR_ME_ONLY" | "TEAM_REFERENCE" | "PROJECT_REFERENCE" | "COMPANY_REFERENCE" | "SSOT_REVIEW";

export interface CreateUploadInput {
  employeeId: string;
  originalFilename: string;
  mimeType: string;
  content: Buffer;
  destination: UploadDestination;
  teamId?: string;
  projectId?: string;
  authorityDomain?: string;
}

export interface CreateUploadResult {
  uploadId: string;
  artifactId: string;
  versionId: string;
  proposalId?: string;
  scope: ArtifactScope;
  knowledgeStatus: KnowledgeStatus;
  dataSensitivity: string;
}

export interface ActionRequestInput {
  employeeId: string;
  actionId?: string;
  actionType?: string;
  parameters?: Record<string, unknown>;
  conversationId?: string;
  idempotencyKey?: string;
}

export interface ActionRequestResult {
  id: string;
  status: string;
  [key: string]: unknown;
}

export interface MemoryRequestInput {
  employeeId: string;
  memoryId?: string;
  type?: string;
  content?: string;
  sensitivity?: string;
  status?: string;
}

export interface MemoryRequestResult {
  id: string;
  employeeId: string;
  [key: string]: unknown;
}

export interface AskRequestInput {
  employeeId: string;
  employeeName: string;
  conversationId: string;
  messageId: string;
  text: string;
}

export interface AskRequestResult {
  status: string;
  text: string;
  citations: unknown[];
  limitations: string[];
  conflictChunkIds: string[];
}

export interface GoogleConnectInput {
  employeeId: string;
  capabilities: string[];
}

export interface GoogleConnectionResult {
  connected: boolean;
  [key: string]: unknown;
}

export interface GoogleOAuthCallbackInput {
  code: string;
  state: string;
}

export interface SSOTProposalInput {
  employeeId: string;
  authorityDomain: string;
  title: string;
  proposedContent: string;
  sourceArtifactIds?: string[];
}

export interface SSOTProposalResult {
  proposalId: string;
  status: string;
}

export interface ReminderRequestInput {
  employeeId: string;
  reminderId?: string;
  text?: string;
  dueAt?: string;
  timezone?: string;
}

export interface ReminderRequestResult {
  id: string;
  employeeId: string;
  status: string;
  [key: string]: unknown;
}

export interface ReadinessResult {
  ready: boolean;
  dependencies: Record<string, string>;
}

export interface ServerOptions {
  internalServiceToken: string;
  logger?: boolean;
  readinessCheck?: () => Promise<ReadinessResult>;
  resolveDiscordIdentity?: (discordUserId: string) => Promise<ResolvedIdentity>;
  searchKnowledge?: (input: SearchInput) => Promise<SearchEvidence[]>;
  createUpload?: (input: CreateUploadInput) => Promise<CreateUploadResult>;
  ask?: (input: AskRequestInput) => Promise<AskRequestResult>;
  createGoogleConnectUrl?: (input: GoogleConnectInput) => Promise<{ url: string }>;
  completeGoogleOAuth?: (input: GoogleOAuthCallbackInput) => Promise<GoogleConnectionResult>;
  getGoogleConnection?: (input: { employeeId: string }) => Promise<GoogleConnectionResult>;
  revokeGoogleConnection?: (input: { employeeId: string }) => Promise<{ revoked: boolean }>;
  prepareAction?: (input: ActionRequestInput) => Promise<ActionRequestResult>;
  confirmAction?: (input: ActionRequestInput) => Promise<ActionRequestResult>;
  executeAction?: (input: ActionRequestInput) => Promise<ActionRequestResult>;
  getAction?: (input: ActionRequestInput) => Promise<ActionRequestResult>;
  cancelAction?: (input: ActionRequestInput) => Promise<ActionRequestResult>;
  listReminders?: (input: ReminderRequestInput) => Promise<ReminderRequestResult[]>;
  createReminder?: (input: ReminderRequestInput) => Promise<ReminderRequestResult>;
  completeReminder?: (input: ReminderRequestInput) => Promise<ReminderRequestResult>;
  cancelReminder?: (input: ReminderRequestInput) => Promise<ReminderRequestResult>;
  listMemory?: (input: MemoryRequestInput) => Promise<MemoryRequestResult[]>;
  createMemory?: (input: MemoryRequestInput) => Promise<MemoryRequestResult>;
  updateMemory?: (input: MemoryRequestInput) => Promise<MemoryRequestResult>;
  deleteMemory?: (input: MemoryRequestInput) => Promise<MemoryRequestResult>;
  getReviewQueue?: (employeeId: string) => Promise<ReviewQueueProposal[]>;
  getSSOTDocument?: (employeeId: string, versionId: string) => Promise<SSOTDocument>;
  createSSOTProposal?: (input: SSOTProposalInput) => Promise<SSOTProposalResult>;
  approveSSOTProposal?: (input: {
    proposalId: string;
    employeeId: string;
  }) => Promise<ReviewActionResult>;
  rejectSSOTProposal?: (input: {
    proposalId: string;
    employeeId: string;
  }) => Promise<ReviewActionResult>;
  requestSSOTChanges?: (input: {
    proposalId: string;
    employeeId: string;
  }) => Promise<ReviewActionResult>;
  uploadMaxBytes?: number;
}

async function defaultCreateSSOTProposal(input: SSOTProposalInput): Promise<SSOTProposalResult> {
  const decision = await evaluateCapability(input.employeeId, "SSOT_PROPOSE");
  if (!decision.allowed) throw new Error("ssot_propose_denied");
  const proposal = await createProposal({
    proposedByEmployeeId: input.employeeId,
    authorityDomain: input.authorityDomain,
    title: input.title,
    proposedContent: input.proposedContent,
    sourceArtifactIds: input.sourceArtifactIds,
  });
  return { proposalId: proposal.id, status: proposal.status };
}

async function defaultReadinessCheck(): Promise<ReadinessResult> {
  const dependencies: Record<string, string> = { database: "unknown", worker: "not_configured" };
  try {
    await db.$queryRaw`SELECT 1`;
    dependencies.database = "ok";
  } catch {
    dependencies.database = "unavailable";
  }
  return {
    ready: dependencies.database === "ok" && dependencies.worker === "ok",
    dependencies,
  };
}

function defaultResolveDiscordIdentity(discordUserId: string): Promise<ResolvedIdentity> {
  return resolveDiscordEmployee(discordUserId).then((employee: Employee) => ({
    id: employee.id,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    discordUserId,
  }));
}

/**
 * Build the Hermes Control Plane API.
 *
 * The API is intentionally model-free: Hermes remains responsible for model
 * reasoning while this service resolves identity and returns permission-
 * filtered evidence.
 */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const readinessCheck = opts.readinessCheck ?? defaultReadinessCheck;
  const resolveIdentity = opts.resolveDiscordIdentity ?? defaultResolveDiscordIdentity;
  const searchKnowledge = opts.searchKnowledge ?? searchVisibleKnowledge;
  const createUpload = opts.createUpload ?? defaultCreateUpload;
  const ask = opts.ask ?? missingAskHandler();
  const createGoogleConnectUrl = opts.createGoogleConnectUrl ?? defaultCreateGoogleConnectUrl;
  const completeGoogleOAuth = opts.completeGoogleOAuth ?? defaultCompleteGoogleOAuth;
  const getGoogleConnection = opts.getGoogleConnection ?? defaultGetGoogleConnection;
  const revokeGoogleConnection = opts.revokeGoogleConnection ?? defaultRevokeGoogleConnection;
  const prepareAction = opts.prepareAction ?? defaultPrepareAction;
  const confirmAction = opts.confirmAction ?? defaultConfirmAction;
  const executeAction = opts.executeAction ?? defaultExecuteAction;
  const getAction = opts.getAction ?? defaultGetAction;
  const cancelAction = opts.cancelAction ?? defaultCancelAction;
  const listReminders = opts.listReminders ?? defaultListReminders;
  const createReminderHandler = opts.createReminder ?? defaultCreateReminder;
  const completeReminderHandler = opts.completeReminder ?? defaultCompleteReminder;
  const cancelReminderHandler = opts.cancelReminder ?? defaultCancelReminder;
  const listMemory = opts.listMemory ?? defaultListMemory;
  const createMemory = opts.createMemory ?? defaultCreateMemory;
  const updateMemory = opts.updateMemory ?? defaultUpdateMemory;
  const deleteMemory = opts.deleteMemory ?? defaultDeleteMemory;
  const getReviewQueue = opts.getReviewQueue ?? getReviewQueueForEmployee;
  const createSSOTProposal = opts.createSSOTProposal ?? defaultCreateSSOTProposal;
  const getSSOTDocument = opts.getSSOTDocument ?? getSSOTDocumentForEmployee;
  const approveSSOTProposal = opts.approveSSOTProposal ?? approveProposalAsReviewer;
  const rejectSSOTProposal = opts.rejectSSOTProposal ?? rejectProposalAsReviewer;
  const requestSSOTChanges = opts.requestSSOTChanges ?? requestChangesAsReviewer;
  const uploadMaxBytes = opts.uploadMaxBytes ?? 10 * 1024 * 1024;

  // Internal auth guard for all /v1/* routes except /v1/health.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/v1/") || url === "/v1/health" || url === "/v1/google/oauth/callback")
      return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_authorization" });
    }
    const token = auth.slice("Bearer ".length);
    if (token !== opts.internalServiceToken) {
      return reply.code(401).send({ error: "invalid_authorization" });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    const result = await readinessCheck();
    return reply.code(result.ready ? 200 : 503).send(result);
  });
  app.get("/v1/health", async () => ({ status: "ok" }));
  app.get("/v1/echo", async () => ({ status: "ok", echo: true }));

  app.post<{ Body: { provider?: string; subjectId?: string } }>(
    "/v1/identity/resolve",
    async (request, reply) => {
      const provider = request.body?.provider;
      const subjectId = request.body?.subjectId?.trim();
      if (provider !== "DISCORD" || !subjectId) {
        return reply.code(400).send({ error: "invalid_identity_request" });
      }

      try {
        const identity = await resolveIdentity(subjectId);
        return {
          employeeId: identity.id,
          employeeCode: identity.employeeCode,
          displayName: identity.displayName,
          provider: "DISCORD",
          subjectId: identity.discordUserId,
        };
      } catch (error) {
        if (error instanceof IdentityDeniedError) {
          return reply.code(403).send({ error: "identity_denied", reason: error.reason });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "identity_resolution_failed" });
      }
    },
  );

  app.post<{
    Body: { discordUserId?: string; query?: string; limit?: number };
  }>("/v1/search", async (request, reply) => {
    const discordUserId = request.body?.discordUserId?.trim();
    const query = request.body?.query?.trim();
    const limit = Number.isFinite(request.body?.limit) ? Number(request.body?.limit) : 10;

    if (!discordUserId || !query) {
      return reply.code(400).send({ error: "invalid_search_request" });
    }

    try {
      const identity = await resolveIdentity(discordUserId);
      const results = await searchKnowledge({
        employeeId: identity.id,
        query,
        limit,
      });
      return { employeeId: identity.id, results };
    } catch (error) {
      if (error instanceof IdentityDeniedError) {
        return reply.code(403).send({ error: "identity_denied", reason: error.reason });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "search_failed" });
    }
  });

  app.post<{
    Body: {
      discordUserId?: string;
      conversationId?: string;
      messageId?: string;
      text?: string;
    };
  }>("/v1/ask", async (request, reply) => {
    const body = request.body ?? {};
    if (
      !body.discordUserId?.trim() ||
      !body.conversationId ||
      !body.messageId ||
      !body.text?.trim()
    ) {
      return reply.code(400).send({ error: "invalid_ask_request" });
    }
    try {
      const identity = await resolveIdentity(body.discordUserId.trim());
      return await ask({
        employeeId: identity.id,
        employeeName: identity.displayName,
        conversationId: body.conversationId,
        messageId: body.messageId,
        text: body.text,
      });
    } catch (error) {
      if (error instanceof IdentityDeniedError) {
        return reply.code(403).send({ error: "identity_denied", reason: error.reason });
      }
      if (error instanceof Error && error.message === "ask_not_configured") {
        return reply.code(503).send({ error: error.message });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "ask_failed" });
    }
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/v1/google/oauth/callback",
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error)
        return reply.code(400).send({ error: "google_authorization_denied", providerError: error });
      if (!code?.trim() || !state?.trim()) {
        return reply.code(400).send({ error: "invalid_google_callback_request" });
      }
      try {
        return await completeGoogleOAuth({ code: code.trim(), state: state.trim() });
      } catch (callbackError) {
        return handleGoogleError(request, reply, callbackError);
      }
    },
  );

  app.post<{
    Body: { discordUserId?: string; capabilities?: string[] };
  }>("/v1/google/connect-url", async (request, reply) => {
    const body = request.body ?? {};
    if (
      !body.discordUserId?.trim() ||
      !Array.isArray(body.capabilities) ||
      body.capabilities.length === 0
    ) {
      return reply.code(400).send({ error: "invalid_google_connect_request" });
    }
    try {
      const identity = await resolveIdentity(body.discordUserId.trim());
      return await createGoogleConnectUrl({
        employeeId: identity.id,
        capabilities: body.capabilities,
      });
    } catch (error) {
      return handleGoogleError(request, reply, error);
    }
  });

  app.get<{ Querystring: { discordUserId?: string } }>(
    "/v1/google/connection",
    async (request, reply) => {
      const discordUserId = request.query.discordUserId?.trim();
      if (!discordUserId)
        return reply.code(400).send({ error: "invalid_google_connection_request" });
      try {
        const identity = await resolveIdentity(discordUserId);
        return await getGoogleConnection({ employeeId: identity.id });
      } catch (error) {
        return handleGoogleError(request, reply, error);
      }
    },
  );

  app.delete<{ Body: { discordUserId?: string } }>(
    "/v1/google/connection",
    async (request, reply) => {
      const discordUserId = request.body?.discordUserId?.trim();
      if (!discordUserId)
        return reply.code(400).send({ error: "invalid_google_connection_request" });
      try {
        const identity = await resolveIdentity(discordUserId);
        return await revokeGoogleConnection({ employeeId: identity.id });
      } catch (error) {
        return handleGoogleError(request, reply, error);
      }
    },
  );

  app.post<{
    Body: {
      discordUserId?: string;
      authorityDomain?: string;
      title?: string;
      proposedContent?: string;
      sourceArtifactIds?: string[];
    };
  }>("/v1/ssot/proposals", async (request, reply) => {
    const body = request.body ?? {};
    if (
      !body.discordUserId?.trim() ||
      !body.authorityDomain?.trim() ||
      !body.title?.trim() ||
      !body.proposedContent?.trim()
    ) {
      return reply.code(400).send({ error: "invalid_ssot_proposal_request" });
    }
    try {
      const identity = await resolveIdentity(body.discordUserId.trim());
      return reply.code(201).send(
        await createSSOTProposal({
          employeeId: identity.id,
          authorityDomain: body.authorityDomain,
          title: body.title,
          proposedContent: body.proposedContent,
          sourceArtifactIds: body.sourceArtifactIds,
        }),
      );
    } catch (error) {
      if (error instanceof IdentityDeniedError)
        return reply.code(403).send({ error: "identity_denied", reason: error.reason });
      if (error instanceof Error && error.message === "ssot_propose_denied")
        return reply.code(403).send({ error: error.message });
      request.log.error(error);
      return reply.code(500).send({ error: "ssot_proposal_failed" });
    }
  });

  app.get<{ Querystring: { discordUserId?: string } }>(
    "/v1/ssot/review-queue",
    async (request, reply) => {
      const discordUserId = request.query.discordUserId?.trim();
      if (!discordUserId) {
        return reply.code(400).send({ error: "invalid_review_queue_request" });
      }

      try {
        const identity = await resolveIdentity(discordUserId);
        const proposals = await getReviewQueue(identity.id);
        return { employeeId: identity.id, proposals };
      } catch (error) {
        if (error instanceof IdentityDeniedError) {
          return reply.code(403).send({ error: "identity_denied", reason: error.reason });
        }
        if (error instanceof Error && error.message === "review_access_denied") {
          return reply.code(403).send({ error: "review_access_denied" });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "review_queue_failed" });
      }
    },
  );

  app.post<{
    Body: { discordUserId?: string; ssotVersionId?: string };
  }>("/v1/ssot/document", async (request, reply) => {
    const discordUserId = request.body?.discordUserId?.trim();
    const ssotVersionId = request.body?.ssotVersionId?.trim();
    if (!discordUserId || !ssotVersionId) {
      return reply.code(400).send({ error: "invalid_ssot_document_request" });
    }

    try {
      const identity = await resolveIdentity(discordUserId);
      return await getSSOTDocument(identity.id, ssotVersionId);
    } catch (error) {
      if (error instanceof IdentityDeniedError) {
        return reply.code(403).send({ error: "identity_denied", reason: error.reason });
      }
      if (error instanceof Error && error.message === "ssot_document_access_denied") {
        return reply.code(403).send({ error: "ssot_document_access_denied" });
      }
      if (error instanceof Error && error.message === "ssot_document_not_found") {
        return reply.code(404).send({ error: "ssot_document_not_found" });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "ssot_document_failed" });
    }
  });

  app.post<{
    Params: { proposalId: string };
    Body: { discordUserId?: string };
  }>("/v1/ssot/proposals/:proposalId/approve", async (request, reply) => {
    return runReviewAction(
      request,
      reply,
      resolveIdentity,
      approveSSOTProposal,
      "proposal_approval_failed",
    );
  });

  app.post<{
    Params: { proposalId: string };
    Body: { discordUserId?: string };
  }>("/v1/ssot/proposals/:proposalId/reject", async (request, reply) => {
    return runReviewAction(
      request,
      reply,
      resolveIdentity,
      rejectSSOTProposal,
      "proposal_rejection_failed",
    );
  });

  app.post<{
    Params: { proposalId: string };
    Body: { discordUserId?: string };
  }>("/v1/ssot/proposals/:proposalId/request-changes", async (request, reply) => {
    return runReviewAction(
      request,
      reply,
      resolveIdentity,
      requestSSOTChanges,
      "proposal_changes_request_failed",
    );
  });

  app.post<{
    Body: {
      discordUserId?: string;
      filename?: string;
      mimeType?: string;
      contentBase64?: string;
      destination?: UploadDestination;
      teamId?: string;
      projectId?: string;
      authorityDomain?: string;
    };
  }>("/v1/uploads", async (request, reply) => {
    const body = request.body ?? {};
    const discordUserId = body.discordUserId?.trim();
    const filename = body.filename?.trim();
    const mimeType = body.mimeType?.trim();
    const contentBase64 = body.contentBase64?.trim();
    const destination = body.destination;

    if (!discordUserId || !filename || !mimeType || !contentBase64 || !destination) {
      return reply.code(400).send({ error: "invalid_upload_request" });
    }
    if (
      ![
        "FOR_ME_ONLY",
        "TEAM_REFERENCE",
        "PROJECT_REFERENCE",
        "COMPANY_REFERENCE",
        "SSOT_REVIEW",
      ].includes(destination)
    ) {
      return reply.code(400).send({ error: "invalid_upload_destination" });
    }

    const content = Buffer.from(contentBase64, "base64");
    if (content.length === 0 || content.length > uploadMaxBytes) {
      return reply.code(413).send({ error: "upload_size_exceeded" });
    }

    try {
      const identity = await resolveIdentity(discordUserId);
      const result = await createUpload({
        employeeId: identity.id,
        originalFilename: filename,
        mimeType,
        content,
        destination,
        teamId: body.teamId,
        projectId: body.projectId,
        authorityDomain: body.authorityDomain,
      });
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof IdentityDeniedError) {
        return reply.code(403).send({ error: "identity_denied", reason: error.reason });
      }
      if (error instanceof Error && error.message === "ssot_review_requires_authority_domain") {
        return reply.code(400).send({ error: "ssot_review_requires_authority_domain" });
      }
      if (error instanceof Error && error.message === "upload_storage_not_configured") {
        return reply.code(503).send({ error: "upload_storage_not_configured" });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "upload_failed" });
    }
  });

  app.post<{
    Body: {
      discordUserId?: string;
      actionType?: string;
      parameters?: Record<string, unknown>;
      conversationId?: string;
      idempotencyKey?: string;
    };
  }>("/v1/actions/prepare", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.actionType || !body.parameters || !body.idempotencyKey) {
      return reply.code(400).send({ error: "invalid_action_prepare_request" });
    }
    return runActionRequest(
      request,
      reply,
      resolveIdentity,
      prepareAction,
      {
        actionType: body.actionType,
        parameters: body.parameters,
        conversationId: body.conversationId,
        idempotencyKey: body.idempotencyKey,
      },
      201,
    );
  });

  app.post<{ Params: { actionId: string }; Body: { discordUserId?: string } }>(
    "/v1/actions/:actionId/confirm",
    async (request, reply) =>
      runActionRequest(request, reply, resolveIdentity, confirmAction, {
        actionId: request.params.actionId,
      }),
  );

  app.post<{ Params: { actionId: string }; Body: { discordUserId?: string } }>(
    "/v1/actions/:actionId/execute",
    async (request, reply) =>
      runActionRequest(request, reply, resolveIdentity, executeAction, {
        actionId: request.params.actionId,
      }),
  );

  app.post<{ Params: { actionId: string }; Body: { discordUserId?: string } }>(
    "/v1/actions/:actionId/cancel",
    async (request, reply) =>
      runActionRequest(request, reply, resolveIdentity, cancelAction, {
        actionId: request.params.actionId,
      }),
  );

  app.get<{ Params: { actionId: string }; Querystring: { discordUserId?: string } }>(
    "/v1/actions/:actionId",
    async (request, reply) =>
      runActionRequest(request, reply, resolveIdentity, getAction, {
        actionId: request.params.actionId,
      }),
  );

  app.get<{ Querystring: { discordUserId?: string } }>("/v1/reminders", async (request, reply) => {
    const discordUserId = request.query.discordUserId?.trim();
    if (!discordUserId) return reply.code(400).send({ error: "invalid_reminder_request" });
    try {
      const identity = await resolveIdentity(discordUserId);
      return {
        employeeId: identity.id,
        reminders: await listReminders({ employeeId: identity.id }),
      };
    } catch (error) {
      return handleReminderError(request, reply, error);
    }
  });

  app.post<{
    Body: {
      discordUserId?: string;
      text?: string;
      dueAt?: string;
      timezone?: string;
      conversationId?: string;
    };
  }>("/v1/reminders", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.discordUserId?.trim() || !body.text?.trim() || !body.dueAt || !body.timezone) {
      return reply.code(400).send({ error: "invalid_reminder_request" });
    }
    try {
      const identity = await resolveIdentity(body.discordUserId.trim());
      return reply.code(201).send(
        await createReminderHandler({
          employeeId: identity.id,
          text: body.text,
          dueAt: body.dueAt,
          timezone: body.timezone,
        }),
      );
    } catch (error) {
      return handleReminderError(request, reply, error);
    }
  });

  app.post<{ Params: { reminderId: string }; Body: { discordUserId?: string } }>(
    "/v1/reminders/:reminderId/complete",
    async (request, reply) =>
      runReminderMutation(request, reply, resolveIdentity, completeReminderHandler),
  );

  app.post<{ Params: { reminderId: string }; Body: { discordUserId?: string } }>(
    "/v1/reminders/:reminderId/cancel",
    async (request, reply) =>
      runReminderMutation(request, reply, resolveIdentity, cancelReminderHandler),
  );

  app.get<{ Querystring: { discordUserId?: string } }>("/v1/memory", async (request, reply) => {
    const discordUserId = request.query.discordUserId?.trim();
    if (!discordUserId) return reply.code(400).send({ error: "invalid_memory_request" });
    try {
      const identity = await resolveIdentity(discordUserId);
      return { employeeId: identity.id, memories: await listMemory({ employeeId: identity.id }) };
    } catch (error) {
      return handleMemoryError(request, reply, error);
    }
  });

  app.post<{
    Body: { discordUserId?: string; type?: string; content?: string; sensitivity?: string };
  }>("/v1/memory", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.discordUserId?.trim() || !body.type || !body.content?.trim()) {
      return reply.code(400).send({ error: "invalid_memory_request" });
    }
    try {
      const identity = await resolveIdentity(body.discordUserId.trim());
      return reply.code(201).send(
        await createMemory({
          employeeId: identity.id,
          type: body.type,
          content: body.content,
          sensitivity: body.sensitivity,
        }),
      );
    } catch (error) {
      return handleMemoryError(request, reply, error);
    }
  });

  app.patch<{
    Params: { memoryId: string };
    Body: { discordUserId?: string; content?: string; sensitivity?: string; status?: string };
  }>("/v1/memory/:memoryId", async (request, reply) => {
    const body = request.body ?? {};
    if (!body.discordUserId?.trim() || !request.params.memoryId) {
      return reply.code(400).send({ error: "invalid_memory_request" });
    }
    if (!body.content && !body.sensitivity && !body.status) {
      return reply.code(400).send({ error: "memory_update_requires_change" });
    }
    try {
      const identity = await resolveIdentity(body.discordUserId.trim());
      return await updateMemory({
        employeeId: identity.id,
        memoryId: request.params.memoryId,
        content: body.content,
        sensitivity: body.sensitivity,
        status: body.status,
      });
    } catch (error) {
      return handleMemoryError(request, reply, error);
    }
  });

  app.delete<{ Params: { memoryId: string }; Body: { discordUserId?: string } }>(
    "/v1/memory/:memoryId",
    async (request, reply) => {
      const discordUserId = request.body?.discordUserId?.trim();
      if (!discordUserId || !request.params.memoryId) {
        return reply.code(400).send({ error: "invalid_memory_request" });
      }
      try {
        const identity = await resolveIdentity(discordUserId);
        return await deleteMemory({ employeeId: identity.id, memoryId: request.params.memoryId });
      } catch (error) {
        return handleMemoryError(request, reply, error);
      }
    },
  );

  return app;
}

async function defaultListReminders(input: ReminderRequestInput): Promise<ReminderRequestResult[]> {
  return (await getRemindersForEmployee(input.employeeId)).map(toReminderResult);
}

async function defaultCreateReminder(input: ReminderRequestInput): Promise<ReminderRequestResult> {
  if (!input.text || !input.dueAt || !input.timezone) throw new Error("reminder_create_invalid");
  return toReminderResult(
    await createReminder({
      employeeId: input.employeeId,
      text: input.text,
      dueAt: new Date(input.dueAt),
      timezone: input.timezone,
    }),
  );
}

async function requireOwnedReminder(employeeId: string, reminderId: string): Promise<void> {
  const reminders = await getRemindersForEmployee(employeeId);
  if (!reminders.some((reminder) => reminder.id === reminderId))
    throw new Error("reminder_not_found");
}

async function defaultCompleteReminder(
  input: ReminderRequestInput,
): Promise<ReminderRequestResult> {
  if (!input.reminderId) throw new Error("reminder_complete_invalid");
  await requireOwnedReminder(input.employeeId, input.reminderId);
  return toReminderResult(await completeReminder(input.reminderId));
}

async function defaultCancelReminder(input: ReminderRequestInput): Promise<ReminderRequestResult> {
  if (!input.reminderId) throw new Error("reminder_cancel_invalid");
  await requireOwnedReminder(input.employeeId, input.reminderId);
  return toReminderResult(await cancelReminder(input.reminderId));
}

function toReminderResult(reminder: {
  id: string;
  employeeId: string;
  text: string;
  dueAt: Date;
  timezone: string;
  status: string;
}): ReminderRequestResult {
  return {
    id: reminder.id,
    employeeId: reminder.employeeId,
    text: reminder.text,
    dueAt: reminder.dueAt,
    timezone: reminder.timezone,
    status: reminder.status,
  };
}

function handleReminderError(
  request: { log: { error(error: unknown): void } },
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  error: unknown,
): unknown {
  if (error instanceof IdentityDeniedError)
    return reply.code(403).send({ error: "identity_denied", reason: error.reason });
  if (error instanceof Error && error.message.endsWith("_not_found"))
    return reply.code(404).send({ error: error.message });
  request.log.error(error);
  return reply.code(500).send({ error: "reminder_request_failed" });
}

async function runReminderMutation(
  request: {
    body?: { discordUserId?: string };
    params: { reminderId: string };
    log: { error(error: unknown): void };
  },
  reply: {
    code(statusCode: number): { send(payload: unknown): unknown };
    send(payload: unknown): unknown;
  },
  resolveIdentity: (discordUserId: string) => Promise<ResolvedIdentity>,
  mutation: (input: ReminderRequestInput) => Promise<ReminderRequestResult>,
): Promise<unknown> {
  const discordUserId = request.body?.discordUserId?.trim();
  if (!discordUserId || !request.params.reminderId)
    return reply.code(400).send({ error: "invalid_reminder_request" });
  try {
    const identity = await resolveIdentity(discordUserId);
    return reply.send(
      await mutation({ employeeId: identity.id, reminderId: request.params.reminderId }),
    );
  } catch (error) {
    return handleReminderError(request, reply, error);
  }
}

async function defaultListMemory(input: MemoryRequestInput): Promise<MemoryRequestResult[]> {
  const memories = await getMemories(input.employeeId);
  return memories.map((memory) => ({
    id: memory.id,
    employeeId: memory.employeeId,
    type: memory.type,
    content: memory.content,
    sensitivity: memory.sensitivity,
    status: memory.status,
  }));
}

async function defaultCreateMemory(input: MemoryRequestInput): Promise<MemoryRequestResult> {
  if (!input.type || !input.content) throw new Error("memory_create_invalid");
  const memory = await addMemory({
    employeeId: input.employeeId,
    type: input.type as MemoryType,
    content: input.content,
    sensitivity: input.sensitivity as MemorySensitivity | undefined,
  });
  return {
    id: memory.id,
    employeeId: memory.employeeId,
    type: memory.type,
    content: memory.content,
    sensitivity: memory.sensitivity,
    status: memory.status,
  };
}

async function requireOwnedMemory(employeeId: string, memoryId: string) {
  const memory = (await getMemories(employeeId)).find((candidate) => candidate.id === memoryId);
  if (!memory) throw new Error("memory_not_found");
  return memory;
}

async function defaultUpdateMemory(input: MemoryRequestInput): Promise<MemoryRequestResult> {
  if (!input.memoryId) throw new Error("memory_update_invalid");
  await requireOwnedMemory(input.employeeId, input.memoryId);
  const memory = await updatePersonalMemory(input.memoryId, {
    content: input.content,
    sensitivity: input.sensitivity as MemorySensitivity | undefined,
    status: input.status as MemoryStatus | undefined,
  });
  return {
    id: memory.id,
    employeeId: memory.employeeId,
    type: memory.type,
    content: memory.content,
    sensitivity: memory.sensitivity,
    status: memory.status,
  };
}

async function defaultDeleteMemory(input: MemoryRequestInput): Promise<MemoryRequestResult> {
  if (!input.memoryId) throw new Error("memory_delete_invalid");
  await requireOwnedMemory(input.employeeId, input.memoryId);
  await deletePersonalMemory(input.memoryId);
  return { id: input.memoryId, employeeId: input.employeeId, status: "DELETED" };
}

function handleMemoryError(
  request: { log: { error(error: unknown): void } },
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  error: unknown,
): unknown {
  if (error instanceof IdentityDeniedError) {
    return reply.code(403).send({ error: "identity_denied", reason: error.reason });
  }
  if (error instanceof Error && error.message.endsWith("_not_configured")) {
    return reply.code(503).send({ error: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "memory_request_failed" });
}

interface ActionRequest {
  body?: unknown;
  query?: unknown;
  params?: unknown;
  log: { error(error: unknown): void };
}

interface ActionReply {
  send(payload: unknown): unknown;
  code(statusCode: number): { send(payload: unknown): unknown };
}

function missingAskHandler() {
  return async (): Promise<AskRequestResult> => {
    throw new Error("ask_not_configured");
  };
}

async function defaultPrepareAction(input: ActionRequestInput): Promise<ActionRequestResult> {
  if (!input.actionType || !input.parameters || !input.idempotencyKey) {
    throw new Error("action_prepare_invalid");
  }
  const proposal = parseActionProposal({
    actionType: input.actionType,
    parameters: input.parameters,
  });
  const validation = validateProposal(proposal);
  if (!validation.valid) throw new Error(`action_invalid: ${validation.errors.join("; ")}`);
  const providers = await googleExecutors(input.employeeId);

  switch (proposal.actionType) {
    case "GMAIL_CREATE_DRAFT":
      return toActionResult(
        await providers.gmail.createDraftAction({
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
          to: String(proposal.parameters.to),
          subject: String(proposal.parameters.subject),
          body: String(proposal.parameters.body),
        }),
      );
    case "GMAIL_SEND_DRAFT":
      return toActionResult(
        await providers.gmail.sendDraftAction({
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          draftActionId: String(proposal.parameters.draftId),
          idempotencyKey: input.idempotencyKey,
        }),
      );
    case "CALENDAR_FREEBUSY":
      return {
        id: "",
        status: (
          await providers.calendar.queryFreeBusy({
            employeeId: input.employeeId,
            idempotencyKey: input.idempotencyKey,
            start: String(proposal.parameters.start),
            end: String(proposal.parameters.end),
          })
        ).status,
        parameters: proposal.parameters,
      };
    case "CALENDAR_CREATE_PERSONAL_EVENT":
      return toActionResult(
        await providers.calendar.createPersonalEventAction({
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
          summary: String(proposal.parameters.summary),
          start: String(proposal.parameters.start),
          end: String(proposal.parameters.end),
        }),
      );
    case "CALENDAR_CREATE_MEETING":
      return toActionResult(
        await providers.calendar.createMeetingAction({
          employeeId: input.employeeId,
          conversationId: input.conversationId,
          idempotencyKey: input.idempotencyKey,
          summary: String(proposal.parameters.summary),
          start: String(proposal.parameters.start),
          end: String(proposal.parameters.end),
          attendees: proposal.parameters.attendees as string[],
        }),
      );
    default:
      throw new Error(`action_type_not_supported: ${proposal.actionType}`);
  }
}

async function defaultConfirmAction(input: ActionRequestInput): Promise<ActionRequestResult> {
  if (!input.actionId) throw new Error("action_confirm_invalid");
  const action = await getStoredAction(input.actionId);
  if (!action || action.employeeId !== input.employeeId) throw new Error("action_not_found");
  if (action.status !== "AWAITING_CONFIRMATION")
    throw new Error("action_confirmation_not_required");
  const confirmedParametersHash = createHash("sha256")
    .update(JSON.stringify(action.parametersJson))
    .digest("hex");
  await db.actionConfirmation.create({
    data: { actionId: action.id, employeeId: input.employeeId, confirmedParametersHash },
  });
  return toActionResult(await transitionAction(action.id, "EXECUTING"));
}

async function defaultExecuteAction(input: ActionRequestInput): Promise<ActionRequestResult> {
  if (!input.actionId) throw new Error("action_execute_invalid");
  const action = await getStoredAction(input.actionId);
  if (!action || action.employeeId !== input.employeeId) throw new Error("action_not_found");
  const providers = await googleExecutors(input.employeeId);
  switch (action.type) {
    case "GMAIL_SEND_DRAFT":
      return toActionResult(await providers.gmail.executeSend(action.id));
    case "CALENDAR_CREATE_MEETING":
      return toActionResult(await providers.calendar.executeCreateMeeting(action.id));
    default:
      throw new Error(`action_execute_not_supported: ${action.type}`);
  }
}

async function defaultGetAction(input: ActionRequestInput): Promise<ActionRequestResult> {
  if (!input.actionId) throw new Error("action_get_invalid");
  const action = await getStoredAction(input.actionId);
  if (!action || action.employeeId !== input.employeeId) throw new Error("action_not_found");
  return toActionResult(action);
}

async function defaultCancelAction(input: ActionRequestInput): Promise<ActionRequestResult> {
  if (!input.actionId) throw new Error("action_cancel_invalid");
  const action = await getStoredAction(input.actionId);
  if (!action || action.employeeId !== input.employeeId) throw new Error("action_not_found");
  return toActionResult(await transitionAction(action.id, "CANCELLED"));
}

async function googleExecutors(employeeId: string): Promise<{
  gmail: GmailActionExecutor;
  calendar: CalendarActionExecutor;
}> {
  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  if (!cfg.googleClientId || !cfg.googleClientSecret || !cfg.tokenEncryptionKey) {
    throw new Error("google_oauth_not_configured");
  }
  const tokenSource = new GoogleOAuthAccessTokenSource(
    cfg.googleClientId,
    cfg.googleClientSecret,
    cfg.tokenEncryptionKey,
  );
  return {
    gmail: new GmailActionExecutor(new GoogleGmailProvider(employeeId, tokenSource)),
    calendar: new CalendarActionExecutor(new GoogleCalendarProvider(employeeId, tokenSource)),
  };
}

function toActionResult(action: {
  id: string;
  employeeId: string;
  status: string;
  type?: string;
  parametersJson?: unknown;
  confirmationRequired?: boolean;
  externalResourceId?: string | null;
}): ActionRequestResult {
  return {
    id: action.id,
    employeeId: action.employeeId,
    status: action.status,
    type: action.type,
    parameters: action.parametersJson,
    confirmationRequired: action.confirmationRequired,
    externalResourceId: action.externalResourceId,
  };
}

async function defaultCreateGoogleConnectUrl(input: GoogleConnectInput): Promise<{ url: string }> {
  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  if (!cfg.googleClientId || !cfg.googleRedirectUri) {
    throw new Error("google_oauth_not_configured");
  }

  const scopes = scopesForCapabilities(input.capabilities);
  const state = await createOAuthState({
    employeeId: input.employeeId,
    requestedScopes: scopes,
    redirectTarget: "/",
    key: cfg.tokenEncryptionKey ?? "",
  });
  return {
    url: buildGoogleAuthorizationUrl({
      clientId: cfg.googleClientId,
      redirectUri: cfg.googleRedirectUri,
      state: state.state,
      scopes,
      hostedDomain: cfg.stagingGoogleHostedDomain,
    }),
  };
}

async function defaultGetGoogleConnection(input: {
  employeeId: string;
}): Promise<GoogleConnectionResult> {
  const connection = await getActiveConnection(input.employeeId);
  if (!connection) return { connected: false };
  return {
    connected: true,
    providerEmail: connection.providerEmail,
    scopes: connection.grantedScopes,
    status: connection.status,
    lastVerifiedAt: connection.lastVerifiedAt,
  };
}

async function defaultRevokeGoogleConnection(input: {
  employeeId: string;
}): Promise<{ revoked: boolean }> {
  await revokeConnection(input.employeeId);
  return { revoked: true };
}

function scopesForCapabilities(capabilities: string[]): string[] {
  const scopes = new Set<string>(["openid", "email"]);
  for (const capability of capabilities) {
    switch (capability) {
      case "GMAIL_DRAFT":
      case "GMAIL_SEND":
        scopes.add("https://www.googleapis.com/auth/gmail.compose");
        break;
      case "CALENDAR_FREEBUSY":
        scopes.add("https://www.googleapis.com/auth/calendar.freebusy");
        break;
      case "CALENDAR_CREATE_PERSONAL_EVENT":
      case "CALENDAR_INVITE_OTHERS":
      case "CALENDAR_UPDATE_EVENT":
      case "CALENDAR_CANCEL_EVENT":
        scopes.add("https://www.googleapis.com/auth/calendar.events");
        break;
      case "DRIVE_FILE":
        scopes.add("https://www.googleapis.com/auth/drive.file");
        break;
      default:
        throw new Error(`unsupported_google_capability: ${capability}`);
    }
  }
  return [...scopes];
}

async function defaultCompleteGoogleOAuth(
  input: GoogleOAuthCallbackInput,
): Promise<GoogleConnectionResult> {
  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  if (
    !cfg.googleClientId ||
    !cfg.googleClientSecret ||
    !cfg.googleRedirectUri ||
    !cfg.tokenEncryptionKey
  ) {
    throw new Error("google_oauth_not_configured");
  }

  const state = await consumeOAuthState(input.state, cfg.tokenEncryptionKey);
  if (!state) throw new Error("google_oauth_state_invalid");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: input.code,
      client_id: cfg.googleClientId,
      client_secret: cfg.googleClientSecret,
      redirect_uri: cfg.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenResponse.ok) throw new Error("google_token_exchange_failed");
  const tokenPayload = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokenPayload.access_token || !tokenPayload.refresh_token) {
    throw new Error("google_refresh_token_missing");
  }

  const userinfoResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenPayload.access_token}` },
  });
  if (!userinfoResponse.ok) throw new Error("google_identity_verification_failed");
  const userinfo = (await userinfoResponse.json()) as {
    sub?: string;
    email?: string;
    hd?: string;
  };
  if (!userinfo.sub) throw new Error("google_subject_missing");
  if (cfg.stagingGoogleHostedDomain && userinfo.hd !== cfg.stagingGoogleHostedDomain) {
    throw new Error("google_hosted_domain_denied");
  }

  const grantedScopes = tokenPayload.scope?.split(" ").filter(Boolean) ?? state.requestedScopes;
  const connection = await saveConnection({
    employeeId: state.employeeId,
    providerAccountId: userinfo.sub,
    providerEmail: userinfo.email,
    hostedDomain: userinfo.hd,
    encryptedRefreshToken: encryptToken(tokenPayload.refresh_token, cfg.tokenEncryptionKey),
    accessTokenExpiresAt: tokenPayload.expires_in
      ? new Date(Date.now() + tokenPayload.expires_in * 1000)
      : undefined,
    grantedScopes,
    key: cfg.tokenEncryptionKey,
  });
  return {
    connected: true,
    providerEmail: connection.providerEmail,
    scopes: connection.grantedScopes,
  };
}

function handleGoogleError(
  request: { log: { error(error: unknown): void } },
  reply: { code(statusCode: number): { send(payload: unknown): unknown } },
  error: unknown,
): unknown {
  if (error instanceof IdentityDeniedError) {
    return reply.code(403).send({ error: "identity_denied", reason: error.reason });
  }
  if (error instanceof Error && error.message.endsWith("_not_configured")) {
    return reply.code(503).send({ error: error.message });
  }
  request.log.error(error);
  return reply.code(500).send({ error: "google_request_failed" });
}

async function runActionRequest(
  request: ActionRequest,
  reply: ActionReply,
  resolveIdentity: (discordUserId: string) => Promise<ResolvedIdentity>,
  action: (input: ActionRequestInput) => Promise<ActionRequestResult>,
  input: Omit<ActionRequestInput, "employeeId">,
  successStatus = 200,
): Promise<unknown> {
  const body = request.body as { discordUserId?: string } | undefined;
  const query = request.query as { discordUserId?: string } | undefined;
  const discordUserId = body?.discordUserId?.trim() ?? query?.discordUserId?.trim();
  if (!discordUserId) {
    return reply.code(400).send({ error: "invalid_action_request" });
  }

  try {
    const identity = await resolveIdentity(discordUserId);
    const result = await action({ ...input, employeeId: identity.id });
    return successStatus === 200 ? reply.send(result) : reply.code(successStatus).send(result);
  } catch (error) {
    if (error instanceof IdentityDeniedError) {
      return reply.code(403).send({ error: "identity_denied", reason: error.reason });
    }
    if (error instanceof Error && error.message.endsWith("_not_configured")) {
      return reply.code(503).send({ error: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: "action_request_failed" });
  }
}

interface ReviewActionRequest {
  body?: { discordUserId?: string };
  params: { proposalId: string };
  log: { error(error: unknown): void };
}

interface ReviewActionReply {
  send(payload: unknown): unknown;
  code(statusCode: number): { send(payload: unknown): unknown };
}

async function runReviewAction(
  request: ReviewActionRequest,
  reply: ReviewActionReply,
  resolveIdentity: (discordUserId: string) => Promise<ResolvedIdentity>,
  action: (input: { proposalId: string; employeeId: string }) => Promise<ReviewActionResult>,
  failureCode: string,
): Promise<unknown> {
  const discordUserId = request.body?.discordUserId?.trim();
  if (!discordUserId || !request.params.proposalId) {
    return reply.code(400).send({ error: "invalid_review_action_request" });
  }

  try {
    const identity = await resolveIdentity(discordUserId);
    return reply.send(
      await action({ proposalId: request.params.proposalId, employeeId: identity.id }),
    );
  } catch (error) {
    if (error instanceof IdentityDeniedError) {
      return reply.code(403).send({ error: "identity_denied", reason: error.reason });
    }
    if (error instanceof Error && error.message === "review_access_denied") {
      return reply.code(403).send({ error: "review_access_denied" });
    }
    if (error instanceof Error && error.message === "proposal not found") {
      return reply.code(404).send({ error: "proposal_not_found" });
    }
    request.log.error(error);
    return reply.code(500).send({ error: failureCode });
  }
}

async function defaultCreateUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
  if (input.destination === "SSOT_REVIEW" && !input.authorityDomain) {
    throw new Error("ssot_review_requires_authority_domain");
  }

  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  if (
    !cfg.objectStorageEndpoint ||
    !cfg.objectStorageBucket ||
    !cfg.objectStorageAccessKey ||
    !cfg.objectStorageSecretKey
  ) {
    throw new Error("upload_storage_not_configured");
  }

  const storage = new ObjectStorage({
    endpoint: cfg.objectStorageEndpoint,
    bucket: cfg.objectStorageBucket,
    accessKey: cfg.objectStorageAccessKey,
    secretKey: cfg.objectStorageSecretKey,
  });
  await storage.createBucketIfNotExists(cfg.objectStorageBucket);

  const imported = await ingestImportedFile({
    storage,
    bucket: cfg.objectStorageBucket,
    submittedByEmployeeId: input.employeeId,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    content: input.content,
    sourceSystem: "HERMES_UPLOAD",
  });
  const classification = classifySubmission({
    filename: input.originalFilename,
    mimeType: input.mimeType,
    content: input.content.toString("utf8"),
    submittedByEmployeeId: input.employeeId,
    teamId: input.teamId,
    projectId: input.projectId,
  });
  const destination = mapUploadDestination(input.destination);
  const submission = await createSubmission({
    artifactId: imported.artifact.id,
    submittedByEmployeeId: input.employeeId,
    ownerEmployeeId: input.employeeId,
    scope: destination.scope,
    teamId: input.teamId,
    projectId: input.projectId,
    knowledgeStatus: destination.knowledgeStatus,
    dataSensitivity: classification.sensitivity,
    authorityDomain: input.authorityDomain,
  });
  let proposalId: string | undefined;
  if (input.destination === "SSOT_REVIEW") {
    const proposal = await createProposal({
      proposedByEmployeeId: input.employeeId,
      authorityDomain: input.authorityDomain!,
      title: input.originalFilename,
      proposedContent: input.content.toString("utf8"),
      sourceArtifactIds: [imported.artifact.id],
    });
    proposalId = proposal.id;
  }

  return {
    uploadId: submission.id,
    artifactId: imported.artifact.id,
    versionId: imported.version.id,
    proposalId,
    scope: destination.scope,
    knowledgeStatus: destination.knowledgeStatus,
    dataSensitivity: classification.sensitivity,
  };
}

function mapUploadDestination(destination: UploadDestination): {
  scope: ArtifactScope;
  knowledgeStatus: KnowledgeStatus;
} {
  switch (destination) {
    case "FOR_ME_ONLY":
      return { scope: "PERSONAL", knowledgeStatus: "PERSONAL_CONTEXT" };
    case "TEAM_REFERENCE":
      return { scope: "TEAM", knowledgeStatus: "REFERENCE" };
    case "PROJECT_REFERENCE":
      return { scope: "PROJECT", knowledgeStatus: "REFERENCE" };
    case "COMPANY_REFERENCE":
      return { scope: "COMPANY", knowledgeStatus: "REFERENCE" };
    case "SSOT_REVIEW":
      return { scope: "COMPANY", knowledgeStatus: "PENDING_REVIEW" };
  }
}

async function start(): Promise<void> {
  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  const app = await buildServer({
    internalServiceToken: cfg.internalServiceToken,
    logger: true,
  });
  await app.listen({ port: cfg.apiPort, host: cfg.apiHost });
}

// Start when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
