import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("authenticated memory API", () => {
  it("keeps memory operations scoped to the resolved employee", async () => {
    const calls: string[] = [];
    const app = await buildServer({
      internalServiceToken: "test-token",
      resolveDiscordIdentity: async (discordUserId) => ({
        id: "employee-1",
        employeeCode: "RL8-EMP-0001",
        displayName: "Employee",
        discordUserId,
      }),
      listMemory: async ({ employeeId }) => {
        calls.push(`list:${employeeId}`);
        return [{ id: "memory-1", employeeId, content: "30-minute meetings" }];
      },
      createMemory: async ({ employeeId, content }) => {
        calls.push(`create:${employeeId}`);
        return { id: "memory-2", employeeId, content };
      },
      deleteMemory: async ({ employeeId, memoryId }) => {
        calls.push(`delete:${employeeId}:${memoryId}`);
        return { id: memoryId, employeeId, status: "DELETED" };
      },
    });

    const headers = { authorization: "Bearer test-token" };
    const list = await app.inject({
      method: "GET",
      url: "/v1/memory?discordUserId=discord-1",
      headers,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().memories[0].employeeId).toBe("employee-1");

    const create = await app.inject({
      method: "POST",
      url: "/v1/memory",
      headers,
      payload: { discordUserId: "discord-1", type: "PREFERENCE", content: "30-minute meetings" },
    });
    expect(create.statusCode).toBe(201);

    const remove = await app.inject({
      method: "DELETE",
      url: "/v1/memory/memory-2",
      headers,
      payload: { discordUserId: "discord-1" },
    });
    expect(remove.statusCode).toBe(200);
    expect(calls).toEqual(["list:employee-1", "create:employee-1", "delete:employee-1:memory-2"]);

    await app.close();
  });
});
