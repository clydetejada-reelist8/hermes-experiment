import { describe, expect, it } from "vitest";
import { encodeRedisCommand, RedisListQueue } from "./queue.js";

describe("Redis worker queue", () => {
  it("encodes Redis commands using RESP", () => {
    expect(encodeRedisCommand(["PING"]).toString()).toBe("*1\r\n$4\r\nPING\r\n");
  });

  it("round-trips a deterministic job through staging Redis", async () => {
    const queue = new RedisListQueue(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
    const name = `hermes-test-${Date.now()}`;
    await queue.enqueue(name, { id: "job-1", name: "artifact-ingestion", data: { artifactVersionId: "version-1" } });
    await expect(queue.dequeue(name, 1)).resolves.toEqual({
      id: "job-1",
      name: "artifact-ingestion",
      data: { artifactVersionId: "version-1" },
    });
  });
});
