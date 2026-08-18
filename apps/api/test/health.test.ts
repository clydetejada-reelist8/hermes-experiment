import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const opts = {
  internalServiceToken: "test-token",
  tokenEncryptionKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  uploadMaxBytes: 10485760,
};

describe("GET /health", () => {
  it("returns 200 and ok status", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe("ok");
    await app.close();
  });
});

describe("GET /health/live", () => {
  it("returns 200 and ok status", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({ method: "GET", url: "/health/live" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe("ok");
    await app.close();
  });
});

describe("GET /v1/health", () => {
  it("returns 200 and ok status", async () => {
    const app = await buildServer(opts);
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe("ok");
    await app.close();
  });
});
