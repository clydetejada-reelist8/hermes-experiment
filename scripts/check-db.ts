#!/usr/bin/env tsx
/**
 * Check staging database connectivity and schema health.
 *
 * Verifies:
 *   1. Database connection works
 *   2. pgvector extension is installed
 *   3. All expected tables exist
 *
 * Usage:
 *   pnpm tsx scripts/check-db.ts
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */
import { db } from "@hermes/db";

const EXPECTED_TABLES = [
  "Employee",
  "ExternalIdentity",
  "Team",
  "EmployeeTeam",
  "Project",
  "ProjectMember",
  "Role",
  "RoleCapability",
  "EmployeeRole",
  "OAuthConnection",
  "OAuthAuthorizationState",
  "Conversation",
  "ConversationMessage",
  "InboundEventReceipt",
  "Artifact",
  "ArtifactVersion",
  "ArtifactSubmission",
  "SourceAccessGrant",
  "KnowledgeChunk",
  "PersonalMemory",
  "AuthorityDomain",
  "DomainAuthority",
  "SSOTRecord",
  "SSOTVersion",
  "SSOTProposal",
  "SSOTProposalSource",
  "Action",
  "ActionConfirmation",
  "Reminder",
  "AuditEvent",
  "FeatureFlag",
  "RetentionPolicy",
];

async function main(): Promise<void> {
  console.log("Checking staging database...\n");

  let allPassed = true;

  // 1. Database connection
  try {
    await db.$queryRaw`SELECT 1`;
    console.log("[+] PASS: Database connection");
  } catch (err) {
    console.log(
      "[-] FAIL: Database connection —",
      err instanceof Error ? err.message : String(err),
    );
    allPassed = false;
  }

  // 2. pgvector extension
  try {
    const rows = await db.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension WHERE extname = 'vector'
    `;
    if (rows.length === 1) {
      console.log("[+] PASS: pgvector extension installed");
    } else {
      console.log("[-] FAIL: pgvector extension not found");
      allPassed = false;
    }
  } catch (err) {
    console.log("[-] FAIL: pgvector check —", err instanceof Error ? err.message : String(err));
    allPassed = false;
  }

  // 3. Table existence
  try {
    const rows = await db.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    const existing = new Set(rows.map((r: { table_name: string }) => r.table_name));
    const missing = EXPECTED_TABLES.filter((t) => !existing.has(t));
    if (missing.length === 0) {
      console.log(`[+] PASS: All ${EXPECTED_TABLES.length} expected tables exist`);
    } else {
      console.log(`[-] FAIL: Missing tables: ${missing.join(", ")}`);
      allPassed = false;
    }
  } catch (err) {
    console.log("[-] FAIL: Table check —", err instanceof Error ? err.message : String(err));
    allPassed = false;
  }

  console.log("");
  if (allPassed) {
    console.log("All database checks passed!");
    process.exit(0);
  } else {
    console.log("Some database checks failed!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Check crashed:", err);
  process.exit(1);
});
