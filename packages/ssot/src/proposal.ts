import { db } from "@hermes/db";
import type { SSOTProposal, SSOTVersion, SSOTRecord } from "@hermes/db";

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
 * The proposed content will become an SSOT version if approved.
 */
export async function createProposal(input: CreateProposalInput): Promise<SSOTProposal> {
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

export interface ApproveProposalInput {
  proposalId: string;
  approvedByEmployeeId: string;
}

export interface ApproveProposalResult {
  proposal: SSOTProposal;
  version: SSOTVersion;
  record: SSOTRecord;
}

/**
 * Approve a proposal and create an SSOT version.
 *
 * This is the key transition: proposed content becomes authoritative.
 * If the proposal is for an existing SSOT record, a new version is created
 * that supersedes the previous one. If it's a new record, both the record
 * and the first version are created.
 *
 * Only AWAITING_REVIEW proposals can be approved.
 */
export async function approveProposal(input: ApproveProposalInput): Promise<ApproveProposalResult> {
  const proposal = await db.sSOTProposal.findUnique({
    where: { id: input.proposalId },
  });
  if (!proposal) throw new Error("proposal not found");
  if (proposal.status !== "AWAITING_REVIEW") {
    throw new Error(`cannot approve proposal with status ${proposal.status}`);
  }

  // Update proposal status
  const updatedProposal = await db.sSOTProposal.update({
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
    record = (await db.sSOTRecord.findUnique({
      where: { id: proposal.ssotRecordId },
    }))!;
    const latestVersion = await db.sSOTVersion.findFirst({
      where: { ssotRecordId: record.id },
      orderBy: { versionNumber: "desc" },
    });
    versionNumber = (latestVersion?.versionNumber ?? 0) + 1;
    supersedesVersionId = latestVersion?.id ?? null;
  } else {
    // New record
    record = await db.sSOTRecord.create({
      data: {
        authorityDomain: proposal.authorityDomain,
        subjectKey: proposal.id,
        title: proposal.title,
      },
    });
    versionNumber = 1;
  }

  // Create the SSOT version
  const version = await db.sSOTVersion.create({
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

  // Update the record's current version
  record = await db.sSOTRecord.update({
    where: { id: record.id },
    data: { currentVersionId: version.id },
  });

  // Link the proposal to the SSOT record
  await db.sSOTProposal.update({
    where: { id: proposal.id },
    data: { ssotRecordId: record.id },
  });

  return { proposal: updatedProposal, version, record };
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

  return db.sSOTProposal.update({
    where: { id: input.proposalId },
    data: {
      status: "REJECTED",
      resolvedAt: new Date(),
    },
  });
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
