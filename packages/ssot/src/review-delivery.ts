import { db } from "@hermes/db";
import type { DomainAuthority } from "@hermes/db";

/**
 * A minimal Discord client abstraction used by the SSOT package to create
 * review threads and post review messages. The ssot package must not depend
 * on discord.js directly; the Discord app supplies a concrete wrapper.
 */
export interface DiscordReviewClient {
  createPrivateThread(name: string, participantIds: string[]): Promise<{ threadId: string }>;
  sendMessage(threadId: string, content: string, components?: unknown[]): Promise<void>;
}

export interface DeliverReviewInput {
  proposalId: string;
  domain: string;
  proposedContent: string;
  proposerEmployeeId: string;
  discordGuildId: string;
  discordClient: DiscordReviewClient;
}

export interface DeliverReviewResult {
  threadId: string;
  reviewerCount: number;
  approverCount: number;
}

export class SSOTReviewDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSOTReviewDeliveryError";
  }
}

/**
 * Discord button styles (raw API values). Used when building the review
 * control components so the ssot package does not need to import discord.js.
 */
const BUTTON_STYLE = {
  SUCCESS: 3,
  DANGER: 4,
  SECONDARY: 2,
} as const;

/**
 * Build the Discord review-control button components (Approve, Reject,
 * Request Changes). Returns raw Discord API component objects so the
 * discordClient.sendMessage can pass them through directly.
 *
 * The custom IDs follow the existing convention used by the Discord app:
 * `approve_proposal:<proposalId>`, `reject_proposal:<proposalId>`,
 * `request_changes:<proposalId>`.
 */
function buildReviewButtons(proposalId: string): unknown[] {
  return [
    {
      type: 1, // ACTION_ROW
      components: [
        {
          type: 2, // BUTTON
          customId: `approve_proposal:${proposalId}`,
          label: "Approve",
          style: BUTTON_STYLE.SUCCESS,
        },
        {
          type: 2, // BUTTON
          customId: `reject_proposal:${proposalId}`,
          label: "Reject",
          style: BUTTON_STYLE.DANGER,
        },
        {
          type: 2, // BUTTON
          customId: `request_changes:${proposalId}`,
          label: "Request Changes",
          style: BUTTON_STYLE.SECONDARY,
        },
      ],
    },
  ];
}

/**
 * Deliver an SSOT proposal for review (Section 16.4).
 *
 * Resolves all active REVIEW and APPROVE authorities for the proposal's
 * domain, creates a private SSOT_REVIEW Discord thread, adds the proposer and
 * all reviewers to the thread, posts the proposed content with review-control
 * buttons, and records the thread ID on the proposal.
 *
 * Throws {@link SSOTReviewDeliveryError} if no approver exists for the domain.
 */
export async function deliverSSOTReview(input: DeliverReviewInput): Promise<DeliverReviewResult> {
  // Resolve all active REVIEW and APPROVE authorities for the domain.
  const authorities = await db.domainAuthority.findMany({
    where: {
      authorityDomain: input.domain,
      permission: { in: ["REVIEW", "APPROVE"] },
      activeFrom: { lte: new Date() },
      OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }],
    },
  });

  const approvers = authorities.filter((a: DomainAuthority) => a.permission === "APPROVE");
  const reviewers = authorities.filter((a: DomainAuthority) => a.permission === "REVIEW");

  if (approvers.length === 0) {
    throw new SSOTReviewDeliveryError("No approver exists for domain");
  }

  // Collect all participant employee IDs (reviewers + approvers + proposer).
  const participantIds = new Set<string>();
  for (const a of authorities) {
    participantIds.add(a.employeeId);
  }
  participantIds.add(input.proposerEmployeeId);

  // Create the private review thread.
  const threadName = `ssot-review-${input.proposalId.slice(0, 8)}`;
  const { threadId } = await input.discordClient.createPrivateThread(threadName, [
    ...participantIds,
  ]);

  // Build the review message content.
  const content = [
    `**SSOT Proposal Review**`,
    `**Domain:** ${input.domain}`,
    `**Proposer:** ${input.proposerEmployeeId}`,
    `**Proposal ID:** ${input.proposalId}`,
    "",
    "```",
    input.proposedContent,
    "```",
  ].join("\n");

  const components = buildReviewButtons(input.proposalId);

  await input.discordClient.sendMessage(threadId, content, components);

  // Record the review thread ID on the proposal.
  await db.sSOTProposal.update({
    where: { id: input.proposalId },
    data: { reviewThreadId: threadId },
  });

  return {
    threadId,
    reviewerCount: reviewers.length,
    approverCount: approvers.length,
  };
}
