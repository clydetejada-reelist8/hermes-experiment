#!/usr/bin/env tsx
/**
 * Admin-only staging purge command (Section 32.4).
 *
 * Truncates all Hermes control-plane tables in the staging database, except
 * for FeatureFlag and RetentionPolicy which are preserved. Requires an
 * explicit STAGING confirmation token to prevent accidental data loss.
 *
 * Usage:
 *   pnpm tsx scripts/clean-db.ts --confirm STAGING
 *
 * Exit codes:
 *   0 = purge successful
 *   1 = confirmation token missing or wrong, or purge failed
 */
import { parseArgs } from "node:util";
import { db } from "@hermes/db";

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

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { confirm: { type: "string" } },
  });

  if (values.confirm !== "STAGING") {
    console.error("ERROR: This command truncates ALL data in the staging database.");
    console.error("To proceed, pass --confirm STAGING");
    process.exit(1);
  }

  console.log("Purging staging database...");
  const list = TABLES_TO_TRUNCATE.map((t) => `"${t}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
  console.log(`Truncated ${TABLES_TO_TRUNCATE.length} tables.`);
  console.log("FeatureFlag and RetentionPolicy preserved.");
  await db.$disconnect();
}

main().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
