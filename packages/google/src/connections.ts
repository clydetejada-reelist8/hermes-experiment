import { db } from "@hermes/db";
import type { OAuthConnection, OAuthAuthorizationState } from "@hermes/db";
import { randomUUID } from "node:crypto";

export type { OAuthConnection, OAuthAuthorizationState };

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface CreateStateInput {
  employeeId: string;
  requestedScopes: string[];
  redirectTarget?: string;
  key: string;
}

/**
 * Create a one-time OAuth state for the Google OAuth flow. The state is a
 * random UUID stored in `OAuthAuthorizationState` with a 10-minute TTL.
 * The `key` parameter is accepted for API symmetry but the state itself is
 * not encrypted (it's a random nonce, not a secret).
 */
export async function createOAuthState(input: CreateStateInput): Promise<{
  id: string;
  state: string;
  expiresAt: Date;
}> {
  const state = randomUUID();
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  const record = await db.oAuthAuthorizationState.create({
    data: {
      employeeId: input.employeeId,
      provider: "GOOGLE",
      state,
      requestedScopes: input.requestedScopes,
      redirectTarget: input.redirectTarget,
      expiresAt,
    },
  });
  return { id: record.id, state: record.state, expiresAt: record.expiresAt };
}

export interface ConsumedState {
  employeeId: string;
  requestedScopes: string[];
  redirectTarget: string | null;
}

/**
 * Consume a one-time OAuth state. Returns null if the state has already been
 * consumed, doesn't exist, or has expired. On success, marks the state as
 * consumed and returns the employee + scope info.
 */
export async function consumeOAuthState(
  state: string,
  _key: string,
): Promise<ConsumedState | null> {
  const record = await db.oAuthAuthorizationState.findUnique({ where: { state } });
  if (!record) return null;
  if (record.consumedAt) return null;
  if (record.expiresAt.getTime() < Date.now()) return null;

  await db.oAuthAuthorizationState.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return {
    employeeId: record.employeeId,
    requestedScopes: record.requestedScopes,
    redirectTarget: record.redirectTarget,
  };
}

export interface SaveConnectionInput {
  employeeId: string;
  providerAccountId: string;
  providerEmail?: string;
  hostedDomain?: string;
  encryptedRefreshToken: string;
  accessTokenExpiresAt?: Date;
  grantedScopes: string[];
  key: string;
}

/**
 * Save (upsert) a Google OAuth connection for an employee. The refresh token
 * must already be encrypted via `encryptToken` before calling this function.
 * The `key` parameter is accepted for API symmetry with `encryptToken` but
 * is not used here — the token is already encrypted.
 */
export async function saveConnection(input: SaveConnectionInput): Promise<OAuthConnection> {
  return db.oAuthConnection.upsert({
    where: {
      provider_providerAccountId: {
        provider: "GOOGLE",
        providerAccountId: input.providerAccountId,
      },
    },
    create: {
      employeeId: input.employeeId,
      provider: "GOOGLE",
      providerAccountId: input.providerAccountId,
      providerEmail: input.providerEmail,
      hostedDomain: input.hostedDomain,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      grantedScopes: input.grantedScopes,
      status: "ACTIVE",
      lastVerifiedAt: new Date(),
    },
    update: {
      employeeId: input.employeeId,
      providerEmail: input.providerEmail,
      hostedDomain: input.hostedDomain,
      encryptedRefreshToken: input.encryptedRefreshToken,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      grantedScopes: input.grantedScopes,
      status: "ACTIVE",
      lastVerifiedAt: new Date(),
    },
  });
}

/**
 * Get the active Google OAuth connection for an employee. Returns null if no
 * active connection exists.
 */
export async function getActiveConnection(employeeId: string): Promise<OAuthConnection | null> {
  const conn = await db.oAuthConnection.findFirst({
    where: { employeeId, provider: "GOOGLE", status: "ACTIVE" },
  });
  return conn;
}

/**
 * Revoke (soft-delete) a Google OAuth connection by setting status to REVOKED.
 * The encrypted refresh token remains in the database for audit purposes but
 * is never used again.
 */
export async function revokeConnection(employeeId: string): Promise<void> {
  await db.oAuthConnection.updateMany({
    where: { employeeId, provider: "GOOGLE", status: "ACTIVE" },
    data: { status: "REVOKED" },
  });
}
