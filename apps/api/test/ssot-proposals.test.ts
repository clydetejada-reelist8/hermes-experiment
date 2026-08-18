import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("SSOT proposal API", () => {
  it("creates a proposal for the resolved employee without publishing it", async () => {
    let received: unknown;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({ id: "employee-1", employeeCode: "RL8-EMP-0001", displayName: "Employee", discordUserId: "discord-1" }),
      createSSOTProposal: async (input) => {
        received = input;
        return { proposalId: "proposal-1", status: "AWAITING_REVIEW" };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ssot/proposals",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "discord-1",
        authorityDomain: "SALES_PROCESS",
        title: "Updated approval process",
        proposedContent: "Sales Director approval is required.",
        sourceArtifactIds: ["artifact-1"],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ proposalId: "proposal-1", status: "AWAITING_REVIEW" });
    expect(received).toEqual({
      employeeId: "employee-1",
      authorityDomain: "SALES_PROCESS",
      title: "Updated approval process",
      proposedContent: "Sales Director approval is required.",
      sourceArtifactIds: ["artifact-1"],
    });
    await app.close();
  });
});
