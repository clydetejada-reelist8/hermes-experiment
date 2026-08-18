import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { indexArtifactVersion } from "./indexing.js";
import { hybridRetrieve, type EmbeddingFunction } from "./retrieval.js";
import { createEmployee, createTeam } from "../../../test/fixtures/db-helpers.js";
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

async function setupLinkedArtifactWithContent(
  content: string,
  syncState: "SYNCED" | "PENDING" | "AUTH_REQUIRED" = "SYNCED",
) {
  const artifact = await db.artifact.create({
    data: {
      type: "TEXT",
      mode: "LINKED",
      sourceSystem: "GOOGLE_DRIVE",
      externalId: randomUUID(),
      syncState,
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

async function createSourceAccessGrant(
  employeeId: string,
  artifactId: string,
  state: "ALLOWED" | "DENIED" | "ERROR" | "UNKNOWN",
  expiresAt: Date | null = null,
) {
  return db.sourceAccessGrant.create({
    data: {
      employeeId,
      artifactId,
      state,
      verifiedAt: new Date(),
      expiresAt,
    },
  });
}

describe("hybridRetrieve", () => {
  it("returns chunks from artifacts the employee owns (PERSONAL)", async () => {
    const emp = await createEmployee();
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

  it("returns COMPANY chunks for any employee", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupArtifactWithContent("Company holiday schedule.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "COMPANY",
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });

    const other = await createEmployee();
    const results = await hybridRetrieve({
      employeeId: other.id,
      query: "holiday",
      queryEmbedding: await new MockEmbeddingFn().embed("holiday"),
      limit: 10,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.some((r) => r.text.includes("holiday"))).toBe(true);
  });
});

describe("hybridRetrieve - LINKED source access revalidation", () => {
  it("includes LINKED artifact with ALLOWED source access grant and SYNCED state", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupLinkedArtifactWithContent("Linked sales forecast data.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    await createSourceAccessGrant(emp.id, artifact.id, "ALLOWED");

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "sales forecast",
      queryEmbedding: await new MockEmbeddingFn().embed("sales forecast"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.some((r) => r.text.includes("sales forecast"))).toBe(true);
  });

  it("excludes LINKED artifact with DENIED source access grant", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupLinkedArtifactWithContent("Linked denied forecast data.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    await createSourceAccessGrant(emp.id, artifact.id, "DENIED");

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "denied forecast",
      queryEmbedding: await new MockEmbeddingFn().embed("denied forecast"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.every((r) => !r.text.includes("denied forecast"))).toBe(true);
  });

  it("excludes LINKED artifact with no source access grant", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupLinkedArtifactWithContent("Linked no-grant forecast data.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    // No SourceAccessGrant created.

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "no-grant forecast",
      queryEmbedding: await new MockEmbeddingFn().embed("no-grant forecast"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.every((r) => !r.text.includes("no-grant forecast"))).toBe(true);
  });

  it("excludes LINKED artifact with expired source access grant", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupLinkedArtifactWithContent("Linked expired forecast data.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    await createSourceAccessGrant(emp.id, artifact.id, "ALLOWED", new Date(Date.now() - 1000));

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "expired forecast",
      queryEmbedding: await new MockEmbeddingFn().embed("expired forecast"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.every((r) => !r.text.includes("expired forecast"))).toBe(true);
  });

  it("includes IMPORTED artifact regardless of source access grants", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupArtifactWithContent("Imported company policy doc.");
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "COMPANY",
      knowledgeStatus: "REFERENCE",
      dataSensitivity: "NORMAL",
    });
    // No SourceAccessGrant — should not matter for IMPORTED artifacts.

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "company policy",
      queryEmbedding: await new MockEmbeddingFn().embed("company policy"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.some((r) => r.text.includes("company policy"))).toBe(true);
  });

  it("excludes LINKED artifact with ALLOWED grant but non-SYNCED state", async () => {
    const emp = await createEmployee();
    const { artifact } = await setupLinkedArtifactWithContent(
      "Linked pending forecast data.",
      "PENDING",
    );
    await createSubmission({
      artifactId: artifact.id,
      submittedByEmployeeId: emp.id,
      scope: "PERSONAL",
      ownerEmployeeId: emp.id,
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    await createSourceAccessGrant(emp.id, artifact.id, "ALLOWED");

    const results = await hybridRetrieve({
      employeeId: emp.id,
      query: "pending forecast",
      queryEmbedding: await new MockEmbeddingFn().embed("pending forecast"),
      limit: 50,
      embeddingFn: new MockEmbeddingFn(),
    });

    expect(results.every((r) => !r.text.includes("pending forecast"))).toBe(true);
  });
});
