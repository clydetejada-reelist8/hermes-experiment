import { describe, expect, it } from "vitest";
import { db } from "@hermes/db";
import {
  createProposal,
  approveProposal,
  rejectProposal,
  requestChanges,
  getProposalsByDomain,
  normalizeAuthorityDomain,
} from "./proposal.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

async function ensureDomain(domain: string) {
  return db.authorityDomain.upsert({
    where: { domain },
    create: { domain },
    update: {},
  });
}

describe("authority domain normalization", () => {
  it("maps company-facing labels to the canonical company key", () => {
    expect(normalizeAuthorityDomain("company SSOT")).toBe("company");
    expect(normalizeAuthorityDomain("Company leadership")).toBe("company");
  });

  it("preserves known domain keys", () => {
    expect(normalizeAuthorityDomain(" engineering ")).toBe("engineering");
  });
});

describe("SSOT proposal lifecycle", () => {
  it("creates a proposal", async () => {
    const emp = await createEmployee();
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
    await ensureDomain("engineering");
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
    await ensureDomain("engineering");
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
    await ensureDomain("engineering");
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
    await ensureDomain("marketing");
    await createProposal({
      proposedByEmployeeId: emp.id,
      authorityDomain: "marketing",
      title: "Brand Guidelines",
      proposedContent: "Use the official logo.",
    });
    const proposals = await getProposalsByDomain("marketing");
    expect(proposals.length).toBeGreaterThanOrEqual(1);
    expect(proposals.some((p) => p.title === "Brand Guidelines")).toBe(true);
  });
});
