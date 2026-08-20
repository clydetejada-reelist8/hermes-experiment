import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("internal auth", () => {
  it("rejects requests to /v1/* without an authorization header", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({ method: "GET", url: "/v1/echo" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects requests with the wrong token", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/echo",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("accepts requests with the correct token", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({
      method: "GET",
      url: "/v1/echo",
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("does not require auth on /health", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("resolves a Discord identity without exposing model credentials", async () => {
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async (discordUserId) => ({
        id: "emp-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Clyde",
        discordUserId,
        profile: {
          company: "REELIST8",
          roles: [],
          teams: [],
          projects: [],
          manager: null,
          capabilities: [],
          linkedIdentities: [],
        },
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/identity/resolve",
      headers: { authorization: "Bearer test-token" },
      payload: { provider: "DISCORD", subjectId: "discord-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      employeeId: "emp-1",
      employeeCode: "RL8-EMP-0001",
      displayName: "Clyde",
      provider: "DISCORD",
      subjectId: "discord-1",
      profile: {
        company: "REELIST8",
        roles: [],
        teams: [],
        projects: [],
        manager: null,
      },
    });
    await app.close();
  });

  it("returns permission-filtered evidence for Hermes without invoking an LLM", async () => {
    let calls = 0;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({
        id: "emp-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Clyde",
        discordUserId: "discord-1",
      }),
      searchKnowledge: async (input) => {
        calls += 1;
        expect(input.employeeId).toBe("emp-1");
        expect(input.query).toBe("sales approval");
        return [
          {
            chunkId: "chunk-1",
            text: "Sales approval requires Finance review.",
            knowledgeStatus: "OFFICIAL",
            scope: "COMPANY",
            sourceType: "SSOT_VERSION",
            citation: "SSOT sales-approval v1",
          },
        ];
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/search",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "discord-1",
        query: "sales approval",
        limit: 5,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      employeeId: "emp-1",
      results: [
        {
          chunkId: "chunk-1",
          text: "Sales approval requires Finance review.",
          knowledgeStatus: "OFFICIAL",
          scope: "COMPANY",
          sourceType: "SSOT_VERSION",
          citation: "SSOT sales-approval v1",
        },
      ],
    });
    expect(calls).toBe(1);
    await app.close();
  });

  it("accepts an authenticated document upload without publishing it as SSOT", async () => {
    let received: unknown;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({
        id: "emp-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Clyde",
        discordUserId: "discord-1",
      }),
      createUpload: async (input) => {
        received = input;
        return {
          uploadId: "upload-1",
          artifactId: "artifact-1",
          versionId: "version-1",
          scope: "PERSONAL",
          knowledgeStatus: "PERSONAL_CONTEXT",
          dataSensitivity: "NORMAL",
        };
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/uploads",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "discord-1",
        filename: "notes.txt",
        mimeType: "text/plain",
        contentBase64: Buffer.from("private notes").toString("base64"),
        destination: "FOR_ME_ONLY",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      uploadId: "upload-1",
      artifactId: "artifact-1",
      versionId: "version-1",
      scope: "PERSONAL",
      knowledgeStatus: "PERSONAL_CONTEXT",
      dataSensitivity: "NORMAL",
    });
    expect(received).toMatchObject({
      employeeId: "emp-1",
      originalFilename: "notes.txt",
      mimeType: "text/plain",
      destination: "FOR_ME_ONLY",
    });
    await app.close();
  });

  it("exposes the SSOT review queue only through the authenticated reviewer path", async () => {
    let requestedEmployeeId = "";
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({
        id: "reviewer-1",
        employeeCode: "RL8-EMP-0002",
        displayName: "Reviewer",
        discordUserId: "discord-reviewer",
      }),
      getReviewQueue: async (employeeId) => {
        requestedEmployeeId = employeeId;
        return [
          {
            id: "proposal-1",
            title: "Sales approval process",
            authorityDomain: "sales",
            status: "AWAITING_REVIEW",
            proposedContent: "Finance review is required.",
            sourceArtifactIds: ["artifact-1"],
          },
        ];
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/ssot/review-queue?discordUserId=discord-reviewer",
      headers: { authorization: "Bearer test-token" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      employeeId: "reviewer-1",
      proposals: [
        {
          id: "proposal-1",
          title: "Sales approval process",
          authorityDomain: "sales",
          status: "AWAITING_REVIEW",
          proposedContent: "Finance review is required.",
          sourceArtifactIds: ["artifact-1"],
        },
      ],
    });
    expect(requestedEmployeeId).toBe("reviewer-1");
    await app.close();
  });

  it("allows an authenticated reviewer to approve a pending proposal", async () => {
    let actionInput: unknown;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({
        id: "reviewer-1",
        employeeCode: "RL8-EMP-0002",
        displayName: "Reviewer",
        discordUserId: "discord-reviewer",
      }),
      approveSSOTProposal: async (input) => {
        actionInput = input;
        return { proposalId: input.proposalId, status: "APPROVED", ssotVersionId: "version-1" };
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/ssot/proposals/proposal-1/approve",
      headers: { authorization: "Bearer test-token" },
      payload: { discordUserId: "discord-reviewer" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      proposalId: "proposal-1",
      status: "APPROVED",
      ssotVersionId: "version-1",
    });
    expect(actionInput).toEqual({ proposalId: "proposal-1", employeeId: "reviewer-1" });
    await app.close();
  });

  it("returns the complete authorized SSOT document", async () => {
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({
        id: "employee-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Employee",
        discordUserId: "discord-1",
      }),
      getSSOTDocument: async () => ({
        recordId: "record-1",
        versionId: "version-1",
        title: "REELIST8 Company Values",
        authorityDomain: "company",
        content: "The Spirit: full text.\nThe Actions: full text.",
        sourceLocators: ["ssot/company-values.md"],
        effectiveFrom: new Date("2026-08-17T00:00:00.000Z"),
        effectiveUntil: null,
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/ssot/document",
      headers: { authorization: "Bearer test-token" },
      payload: { discordUserId: "discord-1", ssotVersionId: "version-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain("The Spirit: full text.");
    expect(res.json().content).toContain("The Actions: full text.");
    await app.close();
  });
});
