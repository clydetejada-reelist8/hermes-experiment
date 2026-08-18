import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { db } from "@hermes/db";
import { randomUUID } from "node:crypto";
import {
  createProposal,
  approveProposal,
  rejectProposal,
  requestChanges,
  getProposalsByDomain,
  SSOTAuthorizationError,
} from "./proposal.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";
import type { Capability } from "@hermes/contracts";

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

/**
 * Grant a set of capabilities to an employee by creating a role with those
 * capabilities and assigning it. Mirrors the pattern used in the policy
 * package tests and pilot-acceptance tests.
 */
async function grantCapabilities(employeeId: string, capabilities: Capability[]): Promise<void> {
  if (capabilities.length === 0) return;
  const suffix = employeeId.slice(0, 8);
  const role = await db.role.create({
    data: { key: `role-${suffix}-${randomUUID().slice(0, 4)}`, name: "Test role" },
  });
  await db.employeeRole.create({ data: { employeeId, roleId: role.id } });
  await db.roleCapability.createMany({
    data: capabilities.map((capability) => ({ roleId: role.id, capability })),
  });
}

/**
 * Grant APPROVE DomainAuthority to an employee for a specific domain.
 */
async function grantDomainAuthority(employeeId: string, domain: string): Promise<void> {
  await db.domainAuthority.create({
    data: {
      authorityDomain: domain,
      employeeId,
      permission: "APPROVE",
    },
  });
}

describe("SSOT proposal lifecycle", () => {
  it("creates a proposal", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE"]);
    await ensureDomain("engineering");
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Code Review Policy",
      proposedContent: "All PRs must be reviewed by at least one engineer.",
    });
    expect(proposal.id).toBeTruthy();
    expect(proposal.status).toBe("AWAITING_REVIEW");
    expect(proposal.title).toBe("Code Review Policy");
  });

  it("approves a proposal and creates an SSOT version", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE", "SSOT_APPROVE"]);
    await ensureDomain("engineering");
    await grantDomainAuthority(emp.id, "engineering");
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Deployment Policy",
      proposedContent: "Deployments must be approved by the team lead.",
    });

    const result = await approveProposal({
      proposalId: proposal.id,
      approvedByEmployeeId: emp.id,
    });

    expect(result.proposal.status).toBe("APPROVED");
    expect(result.version).toBeTruthy();
    expect(result.version.content).toBe("Deployments must be approved by the team lead.");
    expect(result.version.versionNumber).toBe(1);
    expect(result.version.approvedByEmployeeId).toBe(emp.id);
  });

  it("creates a second version when a proposal is approved for an existing SSOT record", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE", "SSOT_APPROVE"]);
    await ensureDomain("engineering");
    await grantDomainAuthority(emp.id, "engineering");
    const p1 = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Meeting Policy",
      proposedContent: "Weekly standup on Mondays.",
    });
    const r1 = await approveProposal({
      proposalId: p1.id,
      approvedByEmployeeId: emp.id,
    });

    const p2 = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Meeting Policy",
      proposedContent: "Weekly standup on Tuesdays.",
      ssotRecordId: r1.version.ssotRecordId,
    });
    const r2 = await approveProposal({
      proposalId: p2.id,
      approvedByEmployeeId: emp.id,
    });

    expect(r2.version.versionNumber).toBe(2);
    expect(r2.version.supersedesVersionId).toBe(r1.version.id);
  });

  it("rejects a proposal", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE"]);
    await ensureDomain("engineering");
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Bad Policy",
      proposedContent: "No reviews needed.",
    });
    const result = await rejectProposal({
      proposalId: proposal.id,
      rejectedByEmployeeId: emp.id,
    });
    expect(result.status).toBe("REJECTED");
    expect(result.resolvedAt).toBeTruthy();
  });

  it("requests changes on a proposal", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE"]);
    await ensureDomain("engineering");
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Draft Policy",
      proposedContent: "Draft content.",
    });
    const result = await requestChanges({
      proposalId: proposal.id,
      reviewedByEmployeeId: emp.id,
    });
    expect(result.status).toBe("CHANGES_REQUESTED");
  });

  it("cannot approve a proposal that is not AWAITING_REVIEW", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE", "SSOT_APPROVE"]);
    await ensureDomain("engineering");
    await grantDomainAuthority(emp.id, "engineering");
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Test Policy",
      proposedContent: "Test content.",
    });
    await rejectProposal({
      proposalId: proposal.id,
      rejectedByEmployeeId: emp.id,
    });
    await expect(
      approveProposal({
        proposalId: proposal.id,
        approvedByEmployeeId: emp.id,
      }),
    ).rejects.toThrow();
  });

  it("lists proposals by domain", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE"]);
    const domain = `marketing-${randomUUID().slice(0, 8)}`;
    await ensureDomain(domain);
    await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: domain,
      title: "Brand Guidelines",
      proposedContent: "Use the official logo.",
    });
    const proposals = await getProposalsByDomain(domain);
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals.some((p) => p.title === "Brand Guidelines")).toBe(true);
  });

  it("rejects proposal creation without SSOT_PROPOSE capability", async () => {
    const emp = await createEmployee();
    await ensureDomain("engineering");
    await expect(
      createProposal({
        proposedByEmployeeId: emp.id,
        authorityDomain: "engineering",
        title: "Unauthorized Policy",
        proposedContent: "Should not be created.",
      }),
    ).rejects.toThrow(SSOTAuthorizationError);
  });

  it("rejects approval without SSOT_APPROVE capability", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE"]);
    await ensureDomain("engineering");
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Policy to Approve",
      proposedContent: "Content.",
    });

    await expect(
      approveProposal({
        proposalId: proposal.id,
        approvedByEmployeeId: emp.id,
      }),
    ).rejects.toThrow(SSOTAuthorizationError);
  });

  it("rejects approval without domain authority", async () => {
    const emp = await createEmployee();
    await grantCapabilities(emp.id, ["SSOT_PROPOSE", "SSOT_APPROVE"]);
    await ensureDomain("engineering");
    // No grantDomainAuthority call — emp has SSOT_APPROVE but no domain authority.
    const proposal = await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "engineering",
      title: "Policy Without Authority",
      proposedContent: "Content.",
    });

    await expect(
      approveProposal({
        proposalId: proposal.id,
        approvedByEmployeeId: emp.id,
      }),
    ).rejects.toThrow(SSOTAuthorizationError);
  });
});
