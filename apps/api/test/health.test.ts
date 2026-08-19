import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

describe("GET /health", () => {
  it("returns 200 and ok status", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe("ok");
    await app.close();
  });
});

describe("GET /version", () => {
  it("returns safe build metadata", async () => {
    const previous = {
      gitCommit: process.env.GIT_COMMIT,
      buildTime: process.env.BUILD_TIME,
      schemaVersion: process.env.SCHEMA_VERSION,
    };
    process.env.GIT_COMMIT = "test-commit";
    process.env.BUILD_TIME = "2026-08-19T00:00:00Z";
    process.env.SCHEMA_VERSION = "test-schema";
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({ method: "GET", url: "/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      gitCommit: "test-commit",
      buildTime: "2026-08-19T00:00:00Z",
      schemaVersion: "test-schema",
    });
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
});
describe("GET /v1/health", () => {
  it("returns 200 and ok status", async () => {
    const app = await buildServer({ internalServiceToken: "test-token" });
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string };
    expect(body.status).toBe("ok");
    await app.close();
  });
});

describe("GET /health/ready", () => {
  it("reports dependency readiness", async () => {
    const app = await buildServer({
      internalServiceToken: "test-token",
      readinessCheck: async () => ({ ready: true, dependencies: { database: "ok", worker: "ok" } }),
    });
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true, dependencies: { database: "ok", worker: "ok" } });
    await app.close();
  });
});
