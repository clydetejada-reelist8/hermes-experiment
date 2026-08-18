import { db } from "@hermes/db";
import type { SSOTProposal, SSOTVersion, SSOTRecord } from "@hermes/db";
import { evaluateCapability } from "@hermes/policy";
import { audit } from "@hermes/audit";
import { isFeatureEnabled } from "@hermes/admin";
import type { EmbeddingFunction } from "@hermes/knowledge";
import { indexSSOTVersion } from "@hermes/knowledge";

export type { SSOTProposal, SSOTVersion, SSOTRecord };

export interface CreateProposalInput {
  proposedByEmployeeId: string;
  authorityDomain: string;
  title: string;
  proposedContent: string;
  ssotRecordId?: string;
  reviewConversationId?: string;
  sourceArtifactIds?: string[];
}

/**
 * Create a new SSOT proposal. Proposals start in AWAITING_REVIEW status.
 *
 * Authorization: the proposing employee must have the SSOT_PROPOSE capability
 * and be active + staging-allowlisted (checked by evaluateCapability).
 */
export async function createProposal(input: CreateProposalInput): Promise<SSOTProposal> {
  const decision = await evaluateCapability(input.proposedByEmployeeId, "SSOT_PROPOSE");
  if (!decision.allowed) {
    throw new SSOTAuthorizationError(
      `cannot propose SSOT: ${decision.reasonCode}`,
      decision.reasonCode,
    );
  }

  // Ensure the authority domain exists.
  await db.authorityDomain.upsert({
    where: { domain: input.authorityDomain },
    create: { domain: input.authorityDomain },
    update: {},
  });

  const proposal = await db.sSOTProposal.create({
    data: {
      proposedByEmployeeId: input.proposedByEmployeeId,
      authorityDomain: input.authorityDomain,
      title: input.title,
      proposedContent: input.proposedContent,
      ssotRecordId: input.ssotRecordId,
      reviewConversationId: input.reviewConversationId,
      status: "AWAITING_REVIEW",
      sources: input.sourceArtifactIds
        ? {
            create: input.sourceArtifactIds.map((artifactId) => ({ artifactId })),
          }
        : undefined,
    },
    include: { sources: true },
  });

  await audit({
    type: "SSOT_PROPOSED",
    employeeId: input.proposedByEmployeeId,
    resourceType: "SSOTProposal",
    resourceId: proposal.id,
    metadata: { authorityDomain: input.authorityDomain, title: input.title },
  });

  return proposal;
}

/**
 * Get a proposal by ID.
 */
export async function getProposal(id: string): Promise<SSOTProposal | null> {
  return db.sSOTProposal.findUnique({
    where: { id },
    include: { sources: true },
  });
}

/**
 * List proposals by authority domain.
 */
export async function getProposalsByDomain(domain: string): Promise<SSOTProposal[]> {
  return db.sSOTProposal.findMany({
    where: { authorityDomain: domain },
    orderBy: { createdAt: "desc" },
  });
}

export class SSOTAuthorizationError extends Error {
  constructor(
    message: string,
    public readonly reasonCode: string,
  ) {
    super(message);
    this.name = "SSOTAuthorizationError";
  }
}

export interface ApproveProposalInput {
  proposalId: string;
  approvedByEmployeeId: string;
  embeddingFn?: EmbeddingFunction;
}

export interface ApproveProposalResult {
  proposal: SSOTProposal;
  version: SSOTVersion;
  record: SSOTRecord;
  indexed: boolean;
}

/**
 * Approve a proposal and create an SSOT version.
 *
 * This is the key transition: proposed content becomes authoritative.
 * If the proposal is for an existing SSOT record, a new version is created
 * that supersedes the previous one. If it's a new record, both the record
 * and the first version are created.
 *
 * Authorization: the approver must have the SSOT_APPROVE capability AND
 * active APPROVE DomainAuthority for the proposal's authority domain.
 * Hermes itself is never an approver (Section 16.7).
 *
 * The entire approval (proposal status update, SSOTVersion creation, record
 * pointer update, proposal-to-record link) runs in a single database
 * transaction (Section 16.6). After the transaction commits, a deterministic
 * post-commit job indexes the new version as KnowledgeChunk records.
 *
 * Only AWAITING_REVIEW proposals can be approved.
 */
export async function approveProposal(input: ApproveProposalInput): Promise<ApproveProposalResult> {
  // Check the ssot feature flag.
  const ssotEnabled = await isFeatureEnabled("ssot_enabled");
  if (!ssotEnabled) {
    throw new SSOTAuthorizationError("SSOT feature is disabled", "FEATURE_DISABLED");
  }

  // Verify the approver has SSOT_APPROVE capability.
  const capDecision = await evaluateCapability(input.approvedByEmployeeId, "SSOT_APPROVE");
  if (!capDecision.allowed) {
    throw new SSOTAuthorizationError(
      `cannot approve SSOT: ${capDecision.reasonCode}`,
      capDecision.reasonCode,
    );
  }

  // Verify the approver has active APPROVE DomainAuthority for the proposal's domain.
  const proposal = await db.sSOTProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) throw new Error("proposal not found");
  if (proposal.status !== "AWAITING_REVIEW") {
    throw new Error(`cannot approve proposal with status ${proposal.status}`);
  }

  const authority = await db.domainAuthority.findFirst({
    where: {
      authorityDomain: proposal.authorityDomain,
      employeeId: input.approvedByEmployeeId,
      permission: "APPROVE",
      activeFrom: { lte: new Date() },
      OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }],
    },
  });
  if (!authority) {
    throw new SSOTAuthorizationError(
      `no active APPROVE authority for domain ${proposal.authorityDomain}`,
      "MISSING_DOMAIN_AUTHORITY",
    );
  }

  // Run the approval in a single transaction.
  const { updatedProposal, version, record } = await db.$transaction(async (tx: typeof db) => {
    const updatedProposal = await tx.sSOTProposal.update({
      where: { id: input.proposalId },
      data: {
        status: "APPROVED",
        resolvedAt: new Date(),
      },
    });

    let record: SSOTRecord;
    let versionNumber: number;
    let supersedesVersionId: string | null = null;

    if (proposal.ssotRecordId) {
      // Existing record — create a new version
      const existingRecord = await tx.sSOTRecord.findUnique({
        where: { id: proposal.ssotRecordId },
      });
      if (!existingRecord) throw new Error("SSOT record not found");
      record = existingRecord;

      const latestVersion = await tx.sSOTVersion.findFirst({
        where: { ssotRecordId: record.id },
        orderBy: { versionNumber: "desc" },
      });
      versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
      supersedesVersionId = latestVersion?.id ?? null;

      // Mark the prior version's effectiveUntil.
      if (latestVersion) {
        await tx.sSOTVersion.update({
          where: { id: latestVersion.id },
          data: { effectiveUntil: new Date() },
        });
      }
    } else {
      // New record
      record = await tx.sSOTRecord.create({
        data: {
          authorityDomain: proposal.authorityDomain,
          subjectKey: proposal.id,
          title: proposal.title,
        },
      });
      versionNumber = 1;
    }

    // Create the SSOT version.
    const version = await tx.sSOTVersion.create({
      data: {
        ssotRecordId: record.id,
        versionNumber,
        content: proposal.proposedContent,
        sourceArtifactId: null,
        effectiveFrom: new Date(),
        approvedByEmployeeId: input.approvedByEmployeeId,
        supersedesVersionId,
      },
    });

    // Update the record's current version pointer.
    record = await tx.sSOTRecord.update({
      where: { id: record.id },
      data: { currentVersionId: version.id },
    });

    // Link the proposal to the SSOT record (in case it was a new record).
    await tx.sSOTProposal.update({
      where: { id: proposal.id },
      data: { ssotRecordId: record.id },
    });

    return { updatedProposal, version, record };
  });

  // Post-commit: index the new SSOT version for retrieval.
  // If indexing fails, the SSOT version remains official in the database but
  // indexedAt stays null; health/operations surfaces the failure and the
  // worker retries safely. Retrieval never invents or cites a chunk that does
  // not exist.
  let indexed = false;
  if (input.embeddingFn) {
    try {
      await indexSSOTVersion({
        ssotVersionId: version.id,
        text: version.content,
        embeddingFn: input.embeddingFn,
      });
      await db.sSOTVersion.update({
        where: { id: version.id },
        data: { indexedAt: new Date() },
      });
      indexed = true;
    } catch {
      // Indexing failed — indexedAt stays null. The worker will retry.
      // The version is still official; it just isn't retrievable yet.
    }
  }

  await audit({
    type: "SSOT_APPROVED",
    employeeId: input.approvedByEmployeeId,
    resourceType: "SSOTVersion",
    resourceId: version.id,
    metadata: {
      authorityDomain: proposal.authorityDomain,
      versionNumber: version.versionNumber,
      indexed,
    },
  });

  return { proposal: updatedProposal, version, record, indexed };
}

export interface RejectProposalInput {
  proposalId: string;
  rejectedByEmployeeId: string;
}

/**
 * Reject a proposal. Only AWAITING_REVIEW proposals can be rejected.
 */
export async function rejectProposal(input: RejectProposalInput): Promise<SSOTProposal> {
  const proposal = await db.sSOTProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) throw new Error("proposal not found");
  if (proposal.status !== "AWAITING_REVIEW") {
    throw new Error(`cannot reject proposal with status ${proposal.status}`);
  }

  const result = await db.sSOTProposal.update({
    where: { id: input.proposalId },
    data: {
      status: "REJECTED",
      resolvedAt: new Date(),
    },
  });

  await audit({
    type: "SSOT_REJECTED",
    employeeId: input.rejectedByEmployeeId,
    resourceType: "SSOTProposal",
    resourceId: input.proposalId,
    metadata: { authorityDomain: proposal.authorityDomain },
  });

  return result;
}

export interface RequestChangesInput {
  proposalId: string;
  reviewedByEmployeeId: string;
}

/**
 * Request changes on a proposal. Only AWAITING_REVIEW proposals can have
 * changes requested.
 */
export async function requestChanges(input: RequestChangesInput): Promise<SSOTProposal> {
  const proposal = await db.sSOTProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) throw new Error("proposal not found");
  if (proposal.status !== "AWAITING_REVIEW") {
    throw new Error(`cannot request changes on proposal with status ${proposal.status}`);
  }

  return db.sSOTProposal.update({
    where: { id: input.proposalId },
    data: {
      status: "CHANGES_REQUESTED",
    },
  });
}
