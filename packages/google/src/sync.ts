import { db } from "@hermes/db";
import type { OAuthConnection } from "./connections.js";
import { decryptToken } from "./crypto.js";

export type { OAuthConnection };

export interface TokenValidator {
  validate(refreshToken: string): Promise<{
    valid: boolean;
    newAccessToken?: string;
    expiresAt?: Date;
  }>;
}

export interface RevalidationResult {
  valid: boolean;
  connection: OAuthConnection;
}

/**
 * Revalidate a single OAuth connection by checking if the refresh token
 * is still valid. If the token is invalid, the connection is revoked.
 *
 * This is a DETERMINISTIC safety check — expired or revoked tokens are
 * immediately disabled, preventing any further API calls with stale
 * credentials.
 */
export async function revalidateConnection(
  connectionId: string,
  validator: TokenValidator,
  key: string,
): Promise<RevalidationResult> {
  const conn = await db.oAuthConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error("connection not found");
  if (conn.status !== "ACTIVE") {
    return { valid: false, connection: conn };
  }

  if (!conn.encryptedRefreshToken) {
    throw new Error("refresh token is missing");
  }
  const refreshToken = decryptToken(conn.encryptedRefreshToken, key);
  const result = await validator.validate(refreshToken);

  if (result.valid) {
    const updated = await db.oAuthConnection.update({
      where: { id: connectionId },
      data: {
        lastVerifiedAt: new Date(),
        accessTokenExpiresAt: result.expiresAt ?? conn.accessTokenExpiresAt,
      },
    });
    return { valid: true, connection: updated };
  }

  // Token is invalid — revoke the connection
  const revoked = await db.oAuthConnection.update({
    where: { id: connectionId },
    data: { status: "REVOKED" },
  });
  return { valid: false, connection: revoked };
}

/**
 * Get all active connections that haven't been verified in the last
 * `thresholdDays` days. These connections need revalidation.
 */
export async function getStaleConnections(thresholdDays: number): Promise<OAuthConnection[]> {
  const threshold = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);
  return db.oAuthConnection.findMany({
    where: {
      status: "ACTIVE",
      lastVerifiedAt: { lt: threshold },
    },
  });
}

/**
 * Revoke all connections with expired access tokens. This is a cleanup
 * operation that runs periodically to remove stale connections.
 *
 * Returns the number of connections revoked.
 */
export async function revokeExpiredConnections(): Promise<number> {
  const result = await db.oAuthConnection.updateMany({
    where: {
      status: "ACTIVE",
      accessTokenExpiresAt: { lt: new Date() },
    },
    data: { status: "REVOKED" },
  });
  return result.count;
}

/**
 * Get all active connections for a specific employee.
 */
export async function getActiveConnectionsForEmployee(
  employeeId: string,
): Promise<OAuthConnection[]> {
  return db.oAuthConnection.findMany({
    where: { employeeId, status: "ACTIVE" },
  });
}
