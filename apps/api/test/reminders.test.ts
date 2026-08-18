import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("authenticated reminders API", () => {
  it("creates, lists, and completes an employee reminder", async () => {
    const calls: string[] = [];
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async () => ({ id: "employee-1", employeeCode: "RL8-EMP-0001", displayName: "Employee", discordUserId: "discord-1" }),
      createReminder: async (input) => { calls.push(`create:${input.employeeId}`); return { id: "reminder-1", employeeId: input.employeeId, status: "OPEN" }; },
      listReminders: async (input) => { calls.push(`list:${input.employeeId}`); return [{ id: "reminder-1", employeeId: input.employeeId, status: "OPEN" }]; },
      completeReminder: async (input) => { calls.push(`complete:${input.employeeId}:${input.reminderId}`); return { id: input.reminderId, employeeId: input.employeeId, status: "COMPLETED" }; },
    });
    const headers = { authorization: "Bearer test-token" };
    const create = await app.inject({ method: "POST", url: "/v1/reminders", headers, payload: { discordUserId: "discord-1", text: "Review staging", dueAt: "2026-08-20T09:00:00Z", timezone: "UTC" } });
    expect(create.statusCode).toBe(201);
    const list = await app.inject({ method: "GET", url: "/v1/reminders?discordUserId=discord-1", headers });
    expect(list.statusCode).toBe(200);
    const complete = await app.inject({ method: "POST", url: "/v1/reminders/reminder-1/complete", headers, payload: { discordUserId: "discord-1" } });
    expect(complete.statusCode).toBe(200);
    expect(calls).toEqual(["create:employee-1", "list:employee-1", "complete:employee-1:reminder-1"]);
    await app.close();
  });
});
