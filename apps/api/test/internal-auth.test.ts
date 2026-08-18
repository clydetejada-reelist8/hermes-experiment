import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const opts = {
  internalServiceToken: "test-token",
  tokenEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  uploadMaxBytes: 10485760,
};

describe("internal auth", () => {
  it("rejects requests to /v1/* without an authorization header", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({ method: "GET", url: "/v1/admin/retention" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("rejects requests with the wrong token", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/retention",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("accepts requests with the correct token", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/retention",
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("does not require auth on /health", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("does not require auth on /v1/health", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("does not require auth on /v1/google/oauth/callback (browser redirect from Google)", async () => {
    const app = await buildServer(opts);
    // The callback validates the state parameter; it should not be rejected
    // by the internal-auth guard since Google redirects the browser here.
    const res = await app.inject({
      method: "GET",
      url: "/v1/google/oauth/callback?code=test-code&state=test-state",
    });
    // Should not be 401 — it will be 400 due to invalid/expired state, but
    // the important assertion is that the auth guard did not reject it.
    expect(res.statusCode).not.toBe(401);
    await app.close();
  });
});
