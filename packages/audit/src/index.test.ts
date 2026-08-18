import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { audit } from "./index.js";
import { db } from "@hermes/db";

describe("audit", () => {
  it("persists a REQUEST_RECEIVED audit event", async () => {
    const marker = randomUUID();
    await audit({
      type: "REQUEST_RECEIVED",
      resourceType: "test",
      resourceId: marker,
      metadata: { foo: "bar" },
    });
    const found = await db.auditEvent.findFirst({
      where: { type: "REQUEST_RECEIVED", resourceId: marker },
    });
    expect(found).not.toBeNull();
    expect((found?.metadata as Record<string, unknown>)?.foo).toBe("bar");
  });

  it("redacts secret-like metadata keys before persistence", async () => {
    const marker = randomUUID();
    await audit({
      type: "MEMORY_CREATED",
      resourceId: marker,
      metadata: {
        refreshToken: "super-secret",
        accessToken: "super-secret",
        authorization: "Bearer x",
        password: "hunter2",
        cookie: "session=abc",
        secret: "shh",
        note: "kept",
      },
    });
    const found = await db.auditEvent.findFirst({ where: { resourceId: marker } });
    const meta = found?.metadata as Record<string, unknown>;
    expect(meta.refreshToken).toBeUndefined();
    expect(meta.accessToken).toBeUndefined();
    expect(meta.authorization).toBeUndefined();
    expect(meta.password).toBeUndefined();
    expect(meta.cookie).toBeUndefined();
    expect(meta.secret).toBeUndefined();
    expect(meta.note).toBe("kept");
  });
});
