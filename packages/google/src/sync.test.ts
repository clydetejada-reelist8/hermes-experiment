import { describe, expect, it } from "vitest";
import { db } from "@hermes/db";
import { encryptToken } from "./crypto.js";
import { saveConnection } from "./connections.js";
import {
  revalidateConnection,
  getStaleConnections,
  revokeExpiredConnections,
  type TokenValidator,
} from "./sync.js";
import { createEmployee } from "../../../test/fixtures/db-helpers.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

class MockTokenValidator implements TokenValidator {
  validTokens = new Set<string>();
  refreshedTokens = new Map<string, string>();

  async validate(
    refreshToken: string,
  ): Promise<{ valid: boolean; newAccessToken?: string; expiresAt?: Date }> {
    if (this.validTokens.has(refreshToken)) {
      return {
        valid: true,
        newAccessToken: "new-access-token",
        expiresAt: new Date(Date.now() + 3600_000),
      };
    }
    return { valid: false };
  }
}

async function setupConnection(empId: string, daysAgo = 0) {
  const token = encryptToken("test-refresh-token", TEST_KEY);
  const lastVerified = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const conn = await saveConnection({
    employeeId: empId,
    providerAccountId: `test-${empId}`,
    providerEmail: "test@example.com",
    encryptedRefreshToken: token,
    grantedScopes: ["https://www.googleapis.com/auth/gmail.send"],
    key: TEST_KEY,
  });
  // Manually set lastVerifiedAt to simulate staleness
  await db.oAuthConnection.update({
    where: { id: conn.id },
    data: { lastVerifiedAt: lastVerified },
  });
  return conn;
}

describe("source sync and revalidation", () => {
  it("revalidates a connection with a valid token", async () => {
    const emp = await createEmployee();
    const conn = await setupConnection(emp.id);
    const validator = new MockTokenValidator();
    validator.validTokens.add("test-refresh-token");

    const result = await revalidateConnection(conn.id, validator, TEST_KEY);
    expect(result.valid).toBe(true);
    expect(result.connection.status).toBe("ACTIVE");
    expect(result.connection.lastVerifiedAt).toBeTruthy();
  });

  it("revokes a connection with an invalid token", async () => {
    const emp = await createEmployee();
    const conn = await setupConnection(emp.id);
    const validator = new MockTokenValidator();
    // Token is not in validTokens, so validation will fail

    const result = await revalidateConnection(conn.id, validator, TEST_KEY);
    expect(result.valid).toBe(false);
    expect(result.connection.status).toBe("REVOKED");
  });

  it("gets stale connections older than threshold", async () => {
    const emp = await createEmployee();
    await setupConnection(emp.id, 8); // 8 days ago

    const stale = await getStaleConnections(7); // 7-day threshold
    expect(stale.some((c) => c.employeeId === emp.id)).toBe(true);
  });

  it("does not return recently verified connections as stale", async () => {
    const emp = await createEmployee();
    await setupConnection(emp.id, 1); // 1 day ago

    const stale = await getStaleConnections(7);
    expect(stale.some((c) => c.employeeId === emp.id)).toBe(false);
  });

  it("revokes all expired connections", async () => {
    const emp = await createEmployee();
    const conn = await setupConnection(emp.id);
    // Mark as expired by setting a past expiry
    await db.oAuthConnection.update({
      where: { id: conn.id },
      data: { accessTokenExpiresAt: new Date(Date.now() - 3600_000) },
    });

    const count = await revokeExpiredConnections();
    expect(count).toBeGreaterThanOrEqual(1);

    const updated = await db.oAuthConnection.findUnique({ where: { id: conn.id } });
    expect(updated?.status).toBe("REVOKED");
  });

  it("does not revoke already-revoked connections", async () => {
    const emp = await createEmployee();
    const conn = await setupConnection(emp.id);
    await db.oAuthConnection.update({
      where: { id: conn.id },
      data: { status: "REVOKED", accessTokenExpiresAt: new Date(Date.now() - 3600_000) },
    });

    await revokeExpiredConnections();
    const updated = await db.oAuthConnection.findUnique({ where: { id: conn.id } });
    expect(updated?.status).toBe("REVOKED");
  });

  it("fails closed when a connection has no refresh token", async () => {
    const emp = await createEmployee();
    const conn = await db.oAuthConnection.create({
      data: {
        employeeId: emp.id,
        provider: "GOOGLE",
        providerAccountId: `missing-token-${emp.id}`,
        encryptedRefreshToken: null,
        grantedScopes: [],
        status: "ACTIVE",
      },
    });

    await expect(revalidateConnection(conn.id, new MockTokenValidator(), TEST_KEY)).rejects.toThrow(
      "refresh token is missing",
    );
  });
});
