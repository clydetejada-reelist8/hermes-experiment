import { db } from "@hermes/db";
import type { AuditEventType } from "./events.js";

export type { AuditEventType } from "./events.js";

/**
 * Metadata keys whose values must never be persisted in audit events. A key is
 * redacted if it case-insensitively contains any of these substrings. This is a
 * defense-in-depth control; callers must additionally avoid passing secrets.
 */
const REDACTED_SUBSTRINGS = ["token", "secret", "authorization", "password", "cookie"];

function isRedactedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return REDACTED_SUBSTRINGS.some((sub) => lower.includes(sub));
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (isRedactedKey(key)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export interface AuditInput {
  type: AuditEventType;
  employeeId?: string;
  conversationId?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persist a sanitized Hermes audit event. Secret-like metadata keys are dropped
 * before persistence. Never log OAuth tokens, access tokens, refresh tokens,
 * passwords, or cookies through this (or any) path.
 */
export async function audit(input: AuditInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      type: input.type,
      employeeId: input.employeeId,
      conversationId: input.conversationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: sanitizeMetadata(input.metadata) ?? undefined,
    },
  });
}
