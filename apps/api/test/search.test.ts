import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import { buildServer } from "../src/server.js";
import { createEmployee, createDiscordIdentity, grantCapability } from "../../../test/fixtures/db-helpers.js";

describe("permission-aware /v1/search", () => {
  it("does not return company evidence to an employee without company-read capability", async () => {
    const publisher = await createEmployee();
    const unauthorized = await createEmployee();
    const identity = await createDiscordIdentity(unauthorized.id);
    const artifact = await db.artifact.create({
      data: {
        type: "TEXT",
        mode: "IMPORTED",
        sourceSystem: "TEST_API_SEARCH",
        externalId: randomUUID(),
        syncState: "SYNCED",
      },
    });
    const version = await db.artifactVersion.create({
      data: { artifactId: artifact.id, versionNumber: 1, contentHash: randomUUID() },
    });
    await db.knowledgeChunk.create({
      data: {
        sourceType: "ARTIFACT_VERSION",
        artifactVersionId: version.id,
        chunkIndex: 0,
        text: "Restricted company authorization policy.",
        tokenEstimate: 5,
      },
    });
    await db.artifactSubmission.create({
      data: {
        artifactId: artifact.id,
        submittedByEmployeeId: publisher.id,
        scope: "COMPANY",
        knowledgeStatus: "REFERENCE",
        dataSensitivity: "NORMAL",
        sourceAccessMode: "HERMES_MANAGED",
        active: true,
      },
    });

    const app = await buildServer({ internalServiceToken: "test-token" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: "Bearer test-token" },
      payload: { discordUserId: identity.providerSubjectId, query: "authorization policy", limit: 10 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([]);
    await app.close();

    await grantCapability(unauthorized.id, "KNOWLEDGE_READ_COMPANY");
  });

  it("returns structured citation metadata for authorized evidence", async () => {
    const employee = await createEmployee();
    await grantCapability(employee.id, "KNOWLEDGE_READ_COMPANY");
    const identity = await createDiscordIdentity(employee.id);
    const artifact = await db.artifact.create({
      data: {
        type: "TEXT",
        mode: "IMPORTED",
        sourceSystem: "TEST_API_SEARCH",
        originalFilename: "authorization-policy.txt",
        externalId: randomUUID(),
        syncState: "SYNCED",
      },
    });
    const version = await db.artifactVersion.create({
      data: { artifactId: artifact.id, versionNumber: 1, contentHash: randomUUID() },
    });
    await db.knowledgeChunk.create({
      data: {
        sourceType: "ARTIFACT_VERSION",
        artifactVersionId: version.id,
        chunkIndex: 0,
        text: "Company authorization policy requires approval.",
        tokenEstimate: 6,
        sourceLocator: "authorization-policy.txt#1",
      },
    });
    await db.artifactSubmission.create({
      data: {
        artifactId: artifact.id,
        submittedByEmployeeId: employee.id,
        scope: "COMPANY",
        knowledgeStatus: "REFERENCE",
        dataSensitivity: "NORMAL",
        sourceAccessMode: "HERMES_MANAGED",
        active: true,
      },
    });

    const app = await buildServer({ internalServiceToken: "test-token" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: "Bearer test-token" },
      payload: { discordUserId: identity.providerSubjectId, query: "authorization policy", limit: 10 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results[0]).toMatchObject({
      sourceTitle: "authorization-policy.txt",
      knowledgeStatus: "REFERENCE",
      version: 1,
      provenance: "authorization-policy.txt#1",
      citation: "authorization-policy.txt#1",
    });
    await app.close();
  });
});
