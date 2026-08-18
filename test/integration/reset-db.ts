import { db } from "@hermes/db";

/**
 * Truncate all Hermes control-plane tables between integration test runs so
 * tests stay deterministic without relying on per-test cleanup. Seed/reference
 * tables that are safe to clear for staging tests are included; FeatureFlag is
 * preserved because feature-flag tests manage it explicitly and other suites
 * may rely on seeded flags.
 */
const TABLES_TO_TRUNCATE = [
  "AuditEvent",
  "ActionConfirmation",
  "Action",
  "Reminder",
  "SSOTProposalSource",
  "SSOTProposal",
  "SSOTVersion",
  "SSOTRecord",
  "KnowledgeChunk",
  "SourceAccessGrant",
  "ArtifactSubmission",
  "ArtifactVersion",
  "Artifact",
  "PersonalMemory",
  "ConversationMessage",
  "Conversation",
  "InboundEventReceipt",
  "OAuthAuthorizationState",
  "OAuthConnection",
  "DomainAuthority",
  "EmployeeRole",
  "ProjectMember",
  "EmployeeTeam",
  "ExternalIdentity",
  "RoleCapability",
  "Role",
  "Project",
  "Team",
  "Employee",
  "AuthorityDomain",
];

export async function resetDatabase(): Promise<void> {
  // TRUNCATE with CASCADE in a single statement, FK-safe.
  const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
}
