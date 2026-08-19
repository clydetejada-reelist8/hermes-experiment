import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("authenticated action API", () => {
  it("prepares, confirms, and executes an employee-owned action", async () => {
    const calls: string[] = [];
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async (discordUserId) => ({
        id: "employee-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Employee",
        discordUserId,
      }),
      prepareAction: async (input) => {
        calls.push(`prepare:${input.employeeId}`);
        return {
          id: "action-1",
          employeeId: input.employeeId,
          type: input.actionType,
          status: "AWAITING_CONFIRMATION",
          confirmationRequired: true,
          parameters: input.parameters,
        };
      },
      confirmAction: async (input) => {
        calls.push(`confirm:${input.employeeId}:${input.actionId}`);
        return { id: input.actionId, status: "CONFIRMED" };
      },
      executeAction: async (input) => {
        calls.push(`execute:${input.employeeId}:${input.actionId}`);
        return { id: input.actionId, status: "SUCCEEDED", externalResourceId: "provider-1" };
      },
    });

    const headers = { authorization: "Bearer test-token" };
    const prepare = await app.inject({
      method: "POST",
      url: "/v1/actions/prepare",
      headers,
      payload: {
        discordUserId: "discord-1",
        actionType: "GMAIL_CREATE_DRAFT",
        parameters: { to: "sarah@example.com", subject: "Hello", body: "Draft" },
        idempotencyKey: "action-key-1",
      },
    });

    expect(prepare.statusCode).toBe(201);
    expect(prepare.json().id).toBe("action-1");

    const confirm = await app.inject({
      method: "POST",
      url: "/v1/actions/action-1/confirm",
      headers,
      payload: { discordUserId: "discord-1" },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json()).toEqual({ id: "action-1", status: "CONFIRMED" });

    const execute = await app.inject({
      method: "POST",
      url: "/v1/actions/action-1/execute",
      headers,
      payload: { discordUserId: "discord-1" },
    });
    expect(execute.statusCode).toBe(200);
    expect(execute.json().status).toBe("SUCCEEDED");
    expect(calls).toEqual([
      "prepare:employee-1",
      "confirm:employee-1:action-1",
      "execute:employee-1:action-1",
    ]);

    await app.close();
  });
});
