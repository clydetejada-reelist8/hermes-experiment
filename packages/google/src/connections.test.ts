import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@hermes/db";
import {
  createOAuthState,
  consumeOAuthState,
  saveConnection,
  getActiveConnection,
  revokeConnection,
} from "./connections.js";
import { encryptToken } from "./crypto.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("OAuth state lifecycle", () => {
  it("creates and consumes a state", async () => {
    const emp = await createEmployee();
    const state = await createOAuthState({
      employeeId: emp.id,
      requestedScopes: ["gmail.readonly"],
      redirectTarget: "/v1/google/done",
      key: KEY,
    });
    expect(state.state).toBeTruthy();
    expect(state.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const consumed = await consumeOAuthState(state.state, KEY);
    expect(consumed).not.toBeNull();
    expect(consumed?.employeeId).toBe(emp.id);
    expect(consumed?.requestedScopes).toContain("gmail.readonly");
  });

  it("rejects a state that has already been consumed", async () => {
    const emp = await createEmployee();
    const state = await createOAuthState({
      employeeId: emp.id,
      requestedScopes: [],
      key: KEY,
    });
    await consumeOAuthState(state.state, KEY);
    const second = await consumeOAuthState(state.state, KEY);
    expect(second).toBeNull();
  });

  it("rejects an unknown state", async () => {
    const result = await consumeOAuthState(randomUUID(), KEY);
    expect(result).toBeNull();
  });
});

describe("connection management", () => {
  it("saves and retrieves an active connection", async () => {
    const emp = await createEmployee();
    await saveConnection({
      employeeId: emp.id,
      providerAccountId: "google-account-123",
      providerEmail: "emp@reelist8.example",
      hostedDomain: "reelist8.example",
      encryptedRefreshToken: encrypt("refresh-secret"),
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      grantedScopes: ["gmail.readonly", "calendar"],
      key: KEY,
    });
    const conn = await getActiveConnection(emp.id);
    expect(conn).not.toBeNull();
    expect(conn?.providerAccountId).toBe("google-account-123");
    expect(conn?.status).toBe("ACTIVE");
  });

  it("revokes a connection", async () => {
    const emp = await createEmployee();
    await saveConnection({
      employeeId: emp.id,
      providerAccountId: "google-account-456",
      providerEmail: "emp@reelist8.example",
      encryptedRefreshToken: encrypt("refresh-secret"),
      grantedScopes: [],
      key: KEY,
    });
    await revokeConnection(emp.id);
    const conn = await getActiveConnection(emp.id);
    expect(conn).toBeNull();
  });

  it("upserts a connection for the same provider account", async () => {
    const emp = await createEmployee();
    await saveConnection({
      employeeId: emp.id,
      providerAccountId: "google-account-789",
      providerEmail: "old@reelist8.example",
      encryptedRefreshToken: encrypt("old-refresh"),
      grantedScopes: ["gmail.readonly"],
      key: KEY,
    });
    await saveConnection({
      employeeId: emp.id,
      providerAccountId: "google-account-789",
      providerEmail: "new@reelist8.example",
      encryptedRefreshToken: encrypt("new-refresh"),
      grantedScopes: ["gmail.readonly", "calendar"],
      key: KEY,
    });
    const conns = await db.oAuthConnection.findMany({
      where: { employeeId: emp.id, provider: "GOOGLE" },
    });
    expect(conns.length).toBe(1);
    expect(conns[0]?.providerEmail).toBe("new@reelist8.example");
  });
});

function encrypt(plaintext: string): string {
  return encryptToken(plaintext, KEY);
}
