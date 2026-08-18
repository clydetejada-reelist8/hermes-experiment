import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@hermes/db";
import { randomUUID } from "node:crypto";
import { deliverSSOTReview, SSOTReviewDeliveryError } from "./review-delivery.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

beforeAll(async () => {
  await db.featureFlag.upsert({
    where: { key: "ssot_enabled" },
    create: { key: "ssot_enabled", enabled: true, updatedBy: "test" },
    update: { enabled: true, updatedBy: "test" },
  });
});

beforeEach(async () => {
  // Re-set the flag in case another test file deleted it.
  await db.featureFlag.upsert({
    where: { key: "ssot_enabled" },
    create: { key: "ssot_enabled", enabled: true, updatedBy: "test" },
    update: { enabled: true, updatedBy: "test" },
  });
});

async function ensureDomain(domain: string) {
  return db.authorityDomain.upsert({
    where: { domain },
    create: { domain },
    update: {},
  });
}

/** Grant SSOT_PROPOSE capability to an employee. */
async function grantProposeCapability(employeeId: string): Promise<void> {
  const role = await db.role.upsert({
    where: { key: "test-proposer" },
    create: { key: "test-proposer", name: "Test Proposer" },
    update: {},
  });
  await db.roleCapability.upsert({
    where: { roleId_capability: { roleId: role.id, capability: "SSOT_PROPOSE" } },
    create: { roleId: role.id, capability: "SSOT_PROPOSE" },
    update: {},
  });
  await db.employeeRole.upsert({
    where: { employeeId_roleId: { employeeId, roleId: role.id } },
    create: { employeeId, roleId: role.id },
    update: {},
  });
}

/** Grant APPROVE DomainAuthority for a domain. */
async function grantApproveAuthority(employeeId: string, domain: string): Promise<void> {
  await db.domainAuthority.upsert({
    where: {
      authorityDomain_employeeId_permission: {
        authorityDomain: domain,
        employeeId,
        permission: "APPROVE",
      },
    },
    create: { authorityDomain: domain, employeeId, permission: "APPROVE" },
    update: {},
  });
}

/** Grant REVIEW DomainAuthority for a domain. */
async function grantReviewAuthority(employeeId: string, domain: string): Promise<void> {
  await db.domainAuthority.upsert({
    where: {
      authorityDomain_employeeId_permission: {
        authorityDomain: domain,
        employeeId,
        permission: "REVIEW",
      },
    },
    create: { authorityDomain: domain, employeeId, permission: "REVIEW" },
    update: {},
  });
}

/** Create a real SSOT proposal record in the database. */
async function createProposalRecord(
  proposedByEmployeeId: string,
  domain: string,
  content: string,
): Promise<string> {
  const proposal = await db.sSOTProposal.create({
    data: {
      proposedByEmployeeId,
      authorityDomain: domain,
      title: "Review Delivery Test",
      proposedContent: content,
      status: "AWAITING_REVIEW",
    },
  });
  return proposal.id;
}

/** Build a mock Discord client that records calls. */
function createMockDiscordClient() {
  const calls = {
    createPrivateThread: [] as Array<{ name: string; participantIds: string[] }>,
    sendMessage: [] as Array<{ threadId: string; content: string; components?: unknown[] }>,
  };
  let threadCounter = 0;

  const discordClient = {
    async createPrivateThread(name: string, participantIds: string[]) {
      calls.createPrivateThread.push({ name, participantIds });
      threadCounter += 1;
      return { threadId: `thread-${threadCounter}` };
    },
    async sendMessage(threadId: string, content: string, components?: unknown[]) {
      calls.sendMessage.push({ threadId, content, components });
    },
  };

  return { discordClient, calls };
}

describe("deliverSSOTReview", () => {
  it("creates a thread and sends a message when approvers exist", async () => {
    const domain = `rd-${randomUUID().slice(0, 8)}`;
    const proposer = await createEmployee();
    await grantProposeCapability(proposer.id);
    const approver = await createEmployee();
    await ensureDomain(domain);
    await grantApproveAuthority(approver.id, domain);

    const proposalId = await createProposalRecord(
      proposer.id,
      domain,
      "All PRs must be reviewed by at least one engineer.",
    );

    const { discordClient, calls } = createMockDiscordClient();

    const result = await deliverSSOTReview({
      proposalId,
      domain,
      proposedContent: "All PRs must be reviewed by at least one engineer.",
      proposerEmployeeId: proposer.id,
      discordGuildId: "guild-1",
      discordClient,
    });

    expect(result.threadId).toBe("thread-1");
    expect(result.approverCount).toBe(1);
    expect(calls.createPrivateThread).toHaveLength(1);
    expect(calls.createPrivateThread[0]!.name).toBe(`ssot-review-${proposalId.slice(0, 8)}`);
    expect(calls.sendMessage).toHaveLength(1);
    expect(calls.sendMessage[0]!.threadId).toBe("thread-1");
    expect(calls.sendMessage[0]!.content).toContain(domain);
    expect(calls.sendMessage[0]!.content).toContain(proposer.id);
    expect(calls.sendMessage[0]!.content).toContain(
      "All PRs must be reviewed by at least one engineer.",
    );
    // Buttons should be present
    expect(calls.sendMessage[0]!.components).toBeTruthy();
    expect(Array.isArray(calls.sendMessage[0]!.components)).toBe(true);

    // The proposal record should be updated with the thread ID.
    const updated = await db.sSOTProposal.findUnique({ where: { id: proposalId } });
    expect(updated?.reviewThreadId).toBe("thread-1");
  });

  it("throws when no approver exists for the domain", async () => {
    const domain = `rd-${randomUUID().slice(0, 8)}`;
    const proposer = await createEmployee();
    await grantProposeCapability(proposer.id);
    const reviewer = await createEmployee();
    await ensureDomain(domain);
    // Only a REVIEW authority, no APPROVE authority
    await grantReviewAuthority(reviewer.id, domain);

    const proposalId = await createProposalRecord(proposer.id, domain, "No approver content.");

    const { discordClient, calls } = createMockDiscordClient();

    await expect(
      deliverSSOTReview({
        proposalId,
        domain,
        proposedContent: "No approver content.",
        proposerEmployeeId: proposer.id,
        discordGuildId: "guild-2",
        discordClient,
      }),
    ).rejects.toBeInstanceOf(SSOTReviewDeliveryError);

    // No thread or message should have been created.
    expect(calls.createPrivateThread).toHaveLength(0);
    expect(calls.sendMessage).toHaveLength(0);
  });

  it("includes both REVIEW and APPROVE authorities as participants", async () => {
    const domain = `rd-${randomUUID().slice(0, 8)}`;
    const proposer = await createEmployee();
    await grantProposeCapability(proposer.id);
    const approver = await createEmployee();
    const reviewer = await createEmployee();
    await ensureDomain(domain);
    await grantApproveAuthority(approver.id, domain);
    await grantReviewAuthority(reviewer.id, domain);

    const proposalId = await createProposalRecord(
      proposer.id,
      domain,
      "Mixed authorities content.",
    );

    const { discordClient, calls } = createMockDiscordClient();

    const result = await deliverSSOTReview({
      proposalId,
      domain,
      proposedContent: "Mixed authorities content.",
      proposerEmployeeId: proposer.id,
      discordGuildId: "guild-3",
      discordClient,
    });

    expect(result.approverCount).toBe(1);
    expect(result.reviewerCount).toBe(1);

    const participants = calls.createPrivateThread[0]!.participantIds;
    expect(participants).toContain(approver.id);
    expect(participants).toContain(reviewer.id);
  });

  it("includes the proposer as a participant", async () => {
    const domain = `rd-${randomUUID().slice(0, 8)}`;
    const proposer = await createEmployee();
    await grantProposeCapability(proposer.id);
    const approver = await createEmployee();
    await ensureDomain(domain);
    await grantApproveAuthority(approver.id, domain);

    const proposalId = await createProposalRecord(
      proposer.id,
      domain,
      "Proposer participant content.",
    );

    const { discordClient, calls } = createMockDiscordClient();

    await deliverSSOTReview({
      proposalId,
      domain,
      proposedContent: "Proposer participant content.",
      proposerEmployeeId: proposer.id,
      discordGuildId: "guild-4",
      discordClient,
    });

    const participants = calls.createPrivateThread[0]!.participantIds;
    expect(participants).toContain(proposer.id);
  });
});
