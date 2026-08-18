import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("Google OAuth API", () => {
  it("creates a capability-scoped Google connection URL for the employee", async () => {
    let received: unknown;
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async (discordUserId) => ({
        id: "employee-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Employee",
        discordUserId,
      }),
      createGoogleConnectUrl: async (input) => {
        received = input;
        return { url: "https://accounts.google.test/o/oauth2/auth?state=state-1" };
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/google/connect-url",
      headers: { authorization: "Bearer test-token" },
      payload: {
        discordUserId: "discord-1",
        capabilities: ["GMAIL_DRAFT", "CALENDAR_FREEBUSY"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      url: "https://accounts.google.test/o/oauth2/auth?state=state-1",
    });
    expect(received).toEqual({
      employeeId: "employee-1",
      capabilities: ["GMAIL_DRAFT", "CALENDAR_FREEBUSY"],
    });
    await app.close();
  });

  it("returns and revokes only the resolved employee's Google connection", async () => {
    const calls: string[] = [];
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({
        id: "employee-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Employee",
        discordUserId: "discord-1",
      }),
      getGoogleConnection: async ({ employeeId }) => {
        calls.push(`get:${employeeId}`);
        return { connected: true, providerEmail: "employee@example.com", scopes: ["gmail.compose"] };
      },
      revokeGoogleConnection: async ({ employeeId }) => {
        calls.push(`revoke:${employeeId}`);
        return { revoked: true };
      },
    });

    const headers = { authorization: "Bearer test-token" };
    const status = await app.inject({
      method: "GET",
      url: "/v1/google/connection?discordUserId=discord-1",
      headers,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().connected).toBe(true);

    const revoke = await app.inject({
      method: "DELETE",
      url: "/v1/google/connection",
      headers,
      payload: { discordUserId: "discord-1" },
    });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json()).toEqual({ revoked: true });
    expect(calls).toEqual(["get:employee-1", "revoke:employee-1"]);
    await app.close();
  });
});
