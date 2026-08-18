import type { EvidenceSourceType } from "./enums.js";

// Canonical Hermes identifier types. Provider IDs are never used as these.
export type EmployeeId = string;
export type ConversationId = string;
export type ArtifactId = string;
export type ArtifactSubmissionId = string;
export type ActionId = string;

export interface RequestActor {
  employeeId: EmployeeId;
  discordUserId: string;
  conversationId?: ConversationId;
}

export type PolicyReasonCode =
  | "ALLOWED"
  | "EMPLOYEE_INACTIVE"
  | "NOT_ALLOWLISTED"
  | "MISSING_CAPABILITY"
  | "HERMES_SCOPE_DENIED"
  | "SOURCE_ACCESS_DENIED"
  | "AUDIENCE_DENIED"
  | "SENSITIVITY_DENIED"
  | "FEATURE_DISABLED";

export interface PolicyDecision {
  allowed: boolean;
  reasonCode: PolicyReasonCode;
}

export interface Citation {
  chunkId: string;
  sourceType: EvidenceSourceType;
  artifactId?: string;
  artifactVersionId?: string;
  ssotVersionId?: string;
  label: string;
  locator?: string;
}

export type AnswerStatus =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "CONFLICTING_SOURCES"
  | "NO_AUTHORITATIVE_SOURCE"
  | "INSUFFICIENT_ACCESS"
  | "SOURCE_NOT_CONNECTED"
  | "NOT_FOUND";

export interface HermesAnswer {
  status: AnswerStatus;
  text: string;
  citations: Citation[];
  limitations: string[];
  conflictChunkIds: string[];
}

export function deny(reasonCode: Exclude<PolicyReasonCode, "ALLOWED">): PolicyDecision {
  return { allowed: false, reasonCode };
}

export function allow(): PolicyDecision {
  return { allowed: true, reasonCode: "ALLOWED" };
}
