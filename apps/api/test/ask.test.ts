import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

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
});
