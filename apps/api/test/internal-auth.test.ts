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
});
