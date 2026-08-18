import Fastify, { type FastifyInstance } from "fastify";
import { classifySubmission, createSubmission, ingestImportedFile } from "@hermes/artifacts";
import type { ArtifactScope, KnowledgeStatus } from "@hermes/contracts";
import { resolveDiscordEmployee, type Employee } from "@hermes/identity";
import { IdentityDeniedError } from "@hermes/identity";
import { ObjectStorage } from "@hermes/storage";
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

export interface ServerOptions {
  internalServiceToken: string;
  logger?: boolean;
  resolveDiscordIdentity?: (discordUserId: string) => Promise<ResolvedIdentity>;
  searchKnowledge?: (input: SearchInput) => Promise<SearchEvidence[]>;
  createUpload?: (input: CreateUploadInput) => Promise<CreateUploadResult>;
  getReviewQueue?: (employeeId: string) => Promise<ReviewQueueProposal[]>;
  getSSOTDocument?: (employeeId: string, versionId: string) => Promise<SSOTDocument>;
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
  const resolveIdentity = opts.resolveDiscordIdentity ?? defaultResolveDiscordIdentity;
  const searchKnowledge = opts.searchKnowledge ?? searchVisibleKnowledge;
  const createUpload = opts.createUpload ?? defaultCreateUpload;
  const getReviewQueue = opts.getReviewQueue ?? getReviewQueueForEmployee;
  const getSSOTDocument = opts.getSSOTDocument ?? getSSOTDocumentForEmployee;
  const approveSSOTProposal = opts.approveSSOTProposal ?? approveProposalAsReviewer;
  const rejectSSOTProposal = opts.rejectSSOTProposal ?? rejectProposalAsReviewer;
  const requestSSOTChanges = opts.requestSSOTChanges ?? requestChangesAsReviewer;
  const uploadMaxBytes = opts.uploadMaxBytes ?? 10 * 1024 * 1024;

  // Internal auth guard for all /v1/* routes except /v1/health.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/v1/") || url === "/v1/health") return;

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

  return app;
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
