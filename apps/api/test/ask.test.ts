import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { IdentityDeniedError } from "@hermes/identity";

describe("authenticated ask API", () => {
  it("resolves the Discord employee before invoking the ask handler", async () => {
    let received: unknown;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async (discordUserId) => ({
        id: "employee-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Employee",
        discordUserId,
      }),
      ask: async (input) => {
        received = input;
        return {
          status: "SUPPORTED",
          text: "The current process is documented here.",
          citations: [{ chunkId: "chunk-1", label: "Sales SOP v1" }],
          limitations: [],
          conflictChunkIds: [],
        };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ask",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "discord-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        text: "What is the current process?",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("SUPPORTED");
    expect(received).toEqual({
      employeeId: "employee-1",
      employeeName: "Employee",
      conversationId: "conversation-1",
      messageId: "message-1",
      text: "What is the current process?",
    });

    await app.close();
  });

  it("answers identity questions from the canonical employee profile", async () => {
    let askCalled = false;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async (discordUserId) => ({
        id: "employee-db-id",
        employeeCode: "RL8-EMP-0001",
        displayName: "Canonical Employee",
        discordUserId,
        profile: {
          company: "REELIST8",
          roles: ["Engineer"],
          teams: ["Platform"],
          projects: ["Hermes"],
          manager: "Engineering Manager",
        },
      }),
      ask: async () => {
        askCalled = true;
        throw new Error("identity questions must not reach the model");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ask",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "discord-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        text: "Who am I?",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().text).toContain("Canonical Employee");
    expect(response.json().text).toContain("RL8-EMP-0001");
    expect(response.json().text).toContain("REELIST8");
    expect(response.json().text).toContain("Platform");
    expect(askCalled).toBe(false);
    await app.close();
  });

  it("gives the explicit unmapped-Discord response for identity questions", async () => {
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => {
        throw new IdentityDeniedError("IDENTITY_NOT_FOUND");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/ask",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "unmapped-discord",
        conversationId: "conversation-1",
        messageId: "message-1",
        text: "What's my employee ID?",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: "identity_not_linked",
      message: "Your Discord account is not currently linked to a REELIST8 employee record.",
    });
    await app.close();
  });
});
