/**
 * Hermes staging enums.
 *
 * These mirror the Prisma schema enums in `packages/db/prisma/schema.prisma`.
 * Application code imports from here; the Prisma client also emits matching
 * enum types. Keep both in sync when changing a value set.
 */

export const EmploymentStatusEnum = ["ACTIVE", "SUSPENDED", "TERMINATED"] as const;
export type EmploymentStatus = (typeof EmploymentStatusEnum)[number];

export const IdentityProviderEnum = ["DISCORD", "GOOGLE", "GITHUB"] as const;
export type IdentityProvider = (typeof IdentityProviderEnum)[number];

export const OAuthStatusEnum = ["ACTIVE", "REVOKED", "ERROR"] as const;
export type OAuthStatus = (typeof OAuthStatusEnum)[number];

export const ConversationTypeEnum = ["ASK", "UPLOAD", "ACTION", "SSOT_REVIEW"] as const;
export type ConversationType = (typeof ConversationTypeEnum)[number];

export const AudienceClassificationEnum = ["PRIVATE", "TEAM", "COMPANY"] as const;
export type AudienceClassification = (typeof AudienceClassificationEnum)[number];

export const ArtifactModeEnum = ["IMPORTED", "LINKED"] as const;
export type ArtifactMode = (typeof ArtifactModeEnum)[number];

export const ArtifactScopeEnum = ["THREAD_ONLY", "PERSONAL", "PROJECT", "TEAM", "COMPANY"] as const;
export type ArtifactScope = (typeof ArtifactScopeEnum)[number];

export const KnowledgeStatusEnum = [
  "PERSONAL_CONTEXT",
  "REFERENCE",
  "PROPOSAL",
  "PENDING_REVIEW",
  "OFFICIAL",
  "HISTORICAL",
  "DISCUSSION",
  "INFERENCE",
] as const;
export type KnowledgeStatus = (typeof KnowledgeStatusEnum)[number];

export const DataSensitivityEnum = ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"] as const;
export type DataSensitivity = (typeof DataSensitivityEnum)[number];

export const SourceAccessStateEnum = ["ALLOWED", "DENIED", "ERROR", "UNKNOWN"] as const;
export type SourceAccessState = (typeof SourceAccessStateEnum)[number];

export const SyncStateEnum = [
  "NOT_REQUIRED",
  "PENDING",
  "SYNCED",
  "AUTH_REQUIRED",
  "DELETED",
  "ERROR",
] as const;
export type SyncState = (typeof SyncStateEnum)[number];

export const MemoryTypeEnum = [
  "PREFERENCE",
  "RESPONSIBILITY",
  "ACTIVE_PROJECT",
  "COLLABORATOR",
  "COMMITMENT",
  "PERSONAL_NOTE",
] as const;
export type MemoryType = (typeof MemoryTypeEnum)[number];

export const MemorySensitivityEnum = ["NORMAL", "SENSITIVE", "HIGHLY_SENSITIVE"] as const;
export type MemorySensitivity = (typeof MemorySensitivityEnum)[number];

export const MemoryStatusEnum = ["ACTIVE", "EXPIRED", "DELETED"] as const;
export type MemoryStatus = (typeof MemoryStatusEnum)[number];

export const ProjectStatusEnum = ["ACTIVE", "ARCHIVED"] as const;
export type ProjectStatus = (typeof ProjectStatusEnum)[number];

export const AuthorityPermissionEnum = ["REVIEW", "APPROVE"] as const;
export type AuthorityPermission = (typeof AuthorityPermissionEnum)[number];

export const CapabilityEnum = [
  "KNOWLEDGE_READ_PERSONAL",
  "KNOWLEDGE_READ_TEAM",
  "KNOWLEDGE_READ_COMPANY",
  "ARTIFACT_UPLOAD",
  "ARTIFACT_SHARE_TEAM",
  "ARTIFACT_SHARE_COMPANY",
  "SSOT_PROPOSE",
  "SSOT_REVIEW",
  "SSOT_APPROVE",
  "MEMORY_READ_OWN",
  "MEMORY_WRITE_OWN",
  "GMAIL_DRAFT",
  "GMAIL_SEND",
  "CALENDAR_FREEBUSY",
  "CALENDAR_CREATE_PERSONAL_EVENT",
  "CALENDAR_INVITE_OTHERS",
  "CALENDAR_UPDATE_EVENT",
  "CALENDAR_CANCEL_EVENT",
  "REMINDERS_WRITE",
  "HERMES_ADMIN",
  "EMPLOYEE_ENROLL",
  "EMPLOYEE_PROFILE_CORRECT",
] as const;
export type Capability = (typeof CapabilityEnum)[number];

export const SSOTProposalStatusEnum = [
  "AWAITING_REVIEW",
  "CHANGES_REQUESTED",
  "REJECTED",
  "APPROVED",
] as const;
export type SSOTProposalStatus = (typeof SSOTProposalStatusEnum)[number];

export const EvidenceSourceTypeEnum = ["ARTIFACT_VERSION", "SSOT_VERSION"] as const;
export type EvidenceSourceType = (typeof EvidenceSourceTypeEnum)[number];

export const ActionTypeEnum = [
  "GMAIL_CREATE_DRAFT",
  "GMAIL_UPDATE_DRAFT",
  "GMAIL_SEND_DRAFT",
  "CALENDAR_FREEBUSY",
  "CALENDAR_CREATE_PERSONAL_EVENT",
  "CALENDAR_CREATE_MEETING",
  "CALENDAR_UPDATE_EVENT",
  "CALENDAR_CANCEL_EVENT",
  "REMINDER_CREATE",
  "REMINDER_COMPLETE",
  "REMINDER_DELETE",
] as const;
export type ActionType = (typeof ActionTypeEnum)[number];

export const ActionRiskLevelEnum = ["LOW", "MEDIUM", "HIGH", "PRIVILEGED"] as const;
export type ActionRiskLevel = (typeof ActionRiskLevelEnum)[number];

export const ActionStatusEnum = [
  "PROPOSED",
  "PREPARED",
  "AWAITING_CONFIRMATION",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "PARTIALLY_SUCCEEDED",
  "OUTCOME_UNKNOWN",
  "CANCELLED",
] as const;
export type ActionStatus = (typeof ActionStatusEnum)[number];

export const ReminderStatusEnum = ["OPEN", "COMPLETED", "CANCELLED"] as const;
export type ReminderStatus = (typeof ReminderStatusEnum)[number];

export const FeatureFlagKeyEnum = [
  "hermes_enabled",
  "ask_enabled",
  "uploads_enabled",
  "memory_enabled",
  "drive_enabled",
  "ssot_enabled",
  "gmail_draft_enabled",
  "gmail_send_enabled",
  "calendar_read_enabled",
  "calendar_write_enabled",
  "reminders_enabled",
  "llm_actions_enabled",
] as const;
export type FeatureFlagKey = (typeof FeatureFlagKeyEnum)[number];

export const AuditEventTypeEnum = [
  "REQUEST_RECEIVED",
  "IDENTITY_RESOLVED",
  "AUTHORIZATION_DENIED",
  "SOURCES_SEARCHED",
  "SOURCES_RETRIEVED",
  "ANSWER_GENERATED",
  "ANSWER_SENT",
  "ARTIFACT_RECEIVED",
  "ARTIFACT_CLASSIFIED",
  "ARTIFACT_INDEXED",
  "SOURCE_ACCESS_REVOKED",
  "MEMORY_CREATED",
  "MEMORY_UPDATED",
  "MEMORY_DELETED",
  "SSOT_PROPOSED",
  "SSOT_APPROVED",
  "SSOT_REJECTED",
  "ACTION_PREPARED",
  "ACTION_CONFIRMED",
  "ACTION_EXECUTED",
  "ACTION_FAILED",
  "FEATURE_FLAG_CHANGED",
  "ADMIN_BOOTSTRAP",
  "ADMIN_ROLE_GRANTED",
  "ADMIN_ROLE_REVOKED",
  "ADMIN_AUTHORITY_GRANTED",
  "ADMIN_AUTHORITY_REVOKED",
  "EMPLOYEE_ENROLLED",
  "EMPLOYEE_IDENTITY_LINKED",
  "EMPLOYEE_PROFILE_CORRECTED",
] as const;
export type AuditEventType = (typeof AuditEventTypeEnum)[number];
