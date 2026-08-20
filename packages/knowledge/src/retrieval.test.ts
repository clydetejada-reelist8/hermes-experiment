import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { indexArtifactVersion, indexSSOTVersion } from "./indexing.js";
import { hybridRetrieve, type EmbeddingFunction } from "./retrieval.js";
import {
  createEmployee,
  createProject,
  createTeam,
  grantCapability,
} from "../../../test/fixtures/db-helpers.js";
import { createSubmission } from "@hermes/artifacts";

class MockEmbeddingFn implements EmbeddingFunction {
  async embed(text: string): Promise<number[]> {
    const vec = new Array(1536).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % 1536] = (vec[i % 1536] + text.charCodeAt(i)) / 1000;
    }
    return vec;
  }
}

async function setupArtifactWithContent(content: string) {
  const artifact = await db.artifact.create({
    data: {
      type: "TEXT",
      mode: "IMPORTED",
      sourceSystem: "TEST",
      externalId: randomUUID(),
      syncState: "SYNCED",
    },
  });
  const version = await db.artifactVersion.create({
    data: { artifactId: artifact.id, versionNumber: 1, contentHash: randomUUID() },
  });
  await indexArtifactVersion({
    artifactVersionId: version.id,
    text: content,
    embeddingFn: new MockEmbeddingFn(),
    chunkOptions: { maxTokens: 500, overlapTokens: 50 },
  });
  return { artifact, version };
}

describe("hybridRetrieve", () => {
  it("returns chunks from artifacts the employee owns (PERSONAL)", async () => {
    const emp = await createEmployee();
    await grantCapability(emp.id, "KNOWLEDGE_READ_PERSONAL");
    const { artifact } = await setupArtifactWithContent("The sales process involves three steps.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "sales process",
      queryEmbedding: await new MockEmbeddingFn().embed("sales process"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.text.includes("sales process"))).toBe(true);
  });

  it("does not return PERSONAL chunks owned by another employee", async () => {
    const owner = await createEmployee();
    const other = await createEmployee();
    await grantCapability(owner.id, "KNOWLEDGE_READ_PERSONAL");
    await grantCapability(other.id, "KNOWLEDGE_READ_PERSONAL");
    const { artifact } = await setupArtifactWithContent("Confidential salary information.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: owner.id,
      scope: "PERSONAL",
      ownerEmployeeId: owner.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "SENSITIVE",
    });

    const results = await hybridRetrieve({
      employeeId: other.id,
      query: "salary",
      queryEmbedding: await new MockEmbeddingFn().embed("salary"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.every((r) => !r.text.includes("Confidential salary"))).toBe(true);
  });

  it("returns TEAM chunks for team members", async () => {
    const emp = await createEmployee();
    const team = await createTeam();
    await grantCapability(emp.id, "KNOWLEDGE_READ_TEAM");
    await db.employeeTeam.create({ data: { employeeId: emp.id, teamId: team.id } });
    const { artifact } = await setupArtifactWithContent("Team quarterly report data.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "TEAM",
      teamId: team.id,
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "quarterly report",
      queryEmbedding: await new MockEmbeddingFn().embed("quarterly report"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.some((r) => r.text.includes("quarterly report"))).toBe(true);
  });

  it("does not return TEAM chunks for non-team-members", async () => {
    const member = await createEmployee();
    const outsider = await createEmployee();
    const team = await createTeam();
    await grantCapability(member.id, "KNOWLEDGE_READ_TEAM");
    await grantCapability(outsider.id, "KNOWLEDGE_READ_TEAM");
    await db.employeeTeam.create({ data: { employeeId: member.id, teamId: team.id } });
    const { artifact } = await setupArtifactWithContent("Team private strategy document.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: member.id,
      scope: "TEAM",
      teamId: team.id,
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });

    const results = await hybridRetrieve({
      employeeId: outsider.id,
      query: "strategy",
      queryEmbedding: await new MockEmbeddingFn().embed("strategy"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.every((r) => !r.text.includes("private strategy"))).toBe(true);
  });

  it("does not return PROJECT chunks for non-project-members", async () => {
    const member = await createEmployee();
    const outsider = await createEmployee();
    await grantCapability(member.id, "KNOWLEDGE_READ_TEAM");
    await grantCapability(outsider.id, "KNOWLEDGE_READ_TEAM");
    const project = await createProject();
    await db.projectMember.create({ data: { employeeId: member.id, projectId: project.id } });
    const { artifact } = await setupArtifactWithContent("Project confidential roadmap.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: member.id,
      scope: "PROJECT",
      projectId: project.id,
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });

    const results = await hybridRetrieve({
      employeeId: outsider.id,
      query: "confidential roadmap",
      queryEmbedding: await new MockEmbeddingFn().embed("confidential roadmap"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });
    expect(results.every((result) => !result.text.includes("Project confidential roadmap"))).toBe(
      true,
    );
  });
  it("returns COMPANY chunks only for employees with company-read capability", async () => {
    const emp = await createEmployee();
    await grantCapability(emp.id, "KNOWLEDGE_READ_COMPANY");
    const { artifact } = await setupArtifactWithContent("Company holiday schedule.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "COMPANY",
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });

    const other = await createEmployee();
    await grantCapability(other.id, "KNOWLEDGE_READ_COMPANY");
    const results = await hybridRetrieve({
      employeeId: other.id,
      query: "holiday",
      queryEmbedding: await new MockEmbeddingFn().embed("holiday"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.some((r) => r.text.includes("holiday"))).toBe(true);

    const unauthorized = await createEmployee();
    const denied = await hybridRetrieve({
      employeeId: unauthorized.id,
      query: "holiday",
      queryEmbedding: await new MockEmbeddingFn().embed("holiday"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });
    expect(denied.every((r) => !r.text.includes("holiday"))).toBe(true);
  });

  it("does not return SSOT chunks without company-read capability", async () => {
    const approver = await createEmployee();
    await grantCapability(approver.id, "KNOWLEDGE_READ_COMPANY");
    const domain = await db.authorityDomain.create({ data: { domain: `domain-${randomUUID()}` } });
    const record = await db.sSOTRecord.create({
      data: { authorityDomain: domain.domain, subjectKey: randomUUID(), title: "Official policy" },
    });
    const version = await db.sSOTVersion.create({
      data: {
        ssotRecordId: record.id,
        versionNumber: 1,
        content: "Official restricted policy.",
        effectiveFrom: new Date(),
        approvedByEmployeeId: approver.id,
      },
    });
    await indexSSOTVersion({
      ssotVersionId: version.id,
      text: version.content,
      embeddingFn: new MockEmbeddingFn(),
    });

    const unauthorized = await createEmployee();
    const denied = await hybridRetrieve({
      employeeId: unauthorized.id,
      query: "restricted policy",
      queryEmbedding: await new MockEmbeddingFn().embed("restricted policy"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });
    expect(denied.every((r) => !r.text.includes("Official restricted policy"))).toBe(true);
  });

  it("rejects linked artifacts without an active source access grant", async () => {
    const owner = await createEmployee();
    await grantCapability(owner.id, "KNOWLEDGE_READ_PERSONAL");
    const artifact = await db.artifact.create({
      data: {
        type: "TEXT",
        mode: "LINKED",
        sourceSystem: "GOOGLE_DRIVE",
        externalId: randomUUID(),
        syncState: "SYNCED",
      },
    });
    const version = await db.artifactVersion.create({
      data: { artifactId: artifact.id, versionNumber: 1, contentHash: randomUUID() },
    });
    await indexArtifactVersion({
      artifactVersionId: version.id,
      text: "Linked private source content.",
      embeddingFn: new MockEmbeddingFn(),
    });
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: owner.id,
      ownerEmployeeId: owner.id,
      scope: "PERSONAL",
      knowledgeStatus: "REFERENCE",
    });
    await db.sourceAccessGrant.create({
      data: {
        artifactId: artifact.id,
        employeeId: owner.id,
        state: "ALLOWED",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const denied = await hybridRetrieve({
      employeeId: owner.id,
      query: "private source",
      queryEmbedding: await new MockEmbeddingFn().embed("private source"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });
    expect(denied.every((r) => !r.text.includes("Linked private source"))).toBe(true);
  });

  it("retrieves punctuation-heavy identifiers exactly", async () => {
    const emp = await createEmployee();
    await grantCapability(emp.id, "KNOWLEDGE_READ_PERSONAL");
    const identifiers = [
      "RL8-PRJ-2026-0047",
      "INV/2026/8821",
      "OPS_RUNBOOK_V3",
      "person@example.com",
      "A9/B.17",
    ];
    const { artifact } = await setupArtifactWithContent(identifiers.join(" | "));
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      ownerEmployeeId: emp.id,
      scope: "PERSONAL",
      knowledgeStatus: "REFERENCE",
    });
    for (const identifier of identifiers) {
      const embedding = await new MockEmbeddingFn().embed(identifier);
      const results = await hybridRetrieve({
        employeeId: emp.id,
        query: identifier,
        queryEmbedding: embedding,
        limit: 10,
        embeddingFn: new MockEmbeddingFn(),
      });
      expect(results.some((result) => result.text.includes(identifier))).toBe(true);
    }
  });
});
