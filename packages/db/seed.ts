/**
 * Seed script for staging environment.
 *
 * Creates:
 *   - Teams (Engineering, Sales, Operations)
 *   - Roles with capabilities (admin, employee, viewer)
 *   - Employees with Discord identities
 *   - Projects with members
 *   - Authority domains for SSOT
 *   - Feature flags (all disabled by default)
 *
 * Usage:
 *   pnpm --filter @hermes/db tsx seed.ts
 */
import { db } from "./src/index.js";

async function main(): Promise<void> {
  console.log("Seeding staging database...");

  // --- Teams ---
  const engineering = await db.team.upsert({
    where: { name: "Engineering" },
    create: { name: "Engineering" },
    update: {},
  });
  const sales = await db.team.upsert({
    where: { name: "Sales" },
    create: { name: "Sales" },
    update: {},
  });
  const operations = await db.team.upsert({
    where: { name: "Operations" },
    create: { name: "Operations" },
    update: {},
  });

  console.log(`  Teams: ${engineering.name}, ${sales.name}, ${operations.name}`);

  // --- Roles ---
  const adminRole = await db.role.upsert({
    where: { key: "admin" },
    create: { key: "admin", name: "Admin" },
    update: {},
  });
  const employeeRole = await db.role.upsert({
    where: { key: "employee" },
    create: { key: "employee", name: "Employee" },
    update: {},
  });
  const viewerRole = await db.role.upsert({
    where: { key: "viewer" },
    create: { key: "viewer", name: "Viewer" },
    update: {},
  });

  // Role capabilities — using the Capability enum values from the schema.
  const adminCaps = [
    "SSOT_PROPOSE",
    "SSOT_REVIEW",
    "SSOT_APPROVE",
    "HERMES_ADMIN",
    "KNOWLEDGE_READ_PERSONAL",
    "KNOWLEDGE_READ_TEAM",
    "KNOWLEDGE_READ_COMPANY",
    "ARTIFACT_UPLOAD",
    "ARTIFACT_SHARE_TEAM",
    "ARTIFACT_SHARE_COMPANY",
    "MEMORY_READ_OWN",
    "MEMORY_WRITE_OWN",
    "GMAIL_DRAFT",
    "GMAIL_SEND",
    "CALENDAR_FREEBUSY",
    "CALENDAR_CREATE_PERSONAL_EVENT",
    "CALENDAR_INVITE_OTHERS",
    "CALENDAR_UPDATE_EVENT",
    "CALENDAR_CANCEL_EVENT",
  ];
  const employeeCaps = [
    "KNOWLEDGE_READ_PERSONAL",
    "KNOWLEDGE_READ_TEAM",
    "KNOWLEDGE_READ_COMPANY",
    "ARTIFACT_UPLOAD",
    "ARTIFACT_SHARE_TEAM",
    "MEMORY_READ_OWN",
    "MEMORY_WRITE_OWN",
    "SSOT_PROPOSE",
    "GMAIL_DRAFT",
    "CALENDAR_FREEBUSY",
    "CALENDAR_CREATE_PERSONAL_EVENT",
  ];
  const viewerCaps = ["KNOWLEDGE_READ_COMPANY", "MEMORY_READ_OWN"];

  for (const cap of adminCaps) {
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: adminRole.id, capability: cap as never } },
      create: { roleId: adminRole.id, capability: cap as never },
      update: {},
    });
  }
  for (const cap of employeeCaps) {
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: employeeRole.id, capability: cap as never } },
      create: { roleId: employeeRole.id, capability: cap as never },
      update: {},
    });
  }
  for (const cap of viewerCaps) {
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: viewerRole.id, capability: cap as never } },
      create: { roleId: viewerRole.id, capability: cap as never },
      update: {},
    });
  }

  console.log(`  Roles: ${adminRole.name}, ${employeeRole.name}, ${viewerRole.name}`);

  // --- Employees ---
  // Employee requires: employeeCode, displayName, companyEmail, timezone.
  // Discord identity is linked via ExternalIdentity.
  const alice = await db.employee.upsert({
    where: { employeeCode: "EMP-0001" },
    create: {
      employeeCode: "EMP-0001",
      displayName: "Alice Admin",
      companyEmail: "alice@reelist8.example",
      timezone: "Asia/Manila",
      stagingAllowlisted: true,
      employmentStatus: "ACTIVE",
    },
    update: {
      displayName: "Alice Admin",
      companyEmail: "alice@reelist8.example",
      stagingAllowlisted: true,
      employmentStatus: "ACTIVE",
    },
  });
  const bob = await db.employee.upsert({
    where: { employeeCode: "EMP-0002" },
    create: {
      employeeCode: "EMP-0002",
      displayName: "Bob Engineer",
      companyEmail: "bob@reelist8.example",
      timezone: "Asia/Manila",
      stagingAllowlisted: true,
      employmentStatus: "ACTIVE",
    },
    update: {
      displayName: "Bob Engineer",
      companyEmail: "bob@reelist8.example",
      stagingAllowlisted: true,
      employmentStatus: "ACTIVE",
    },
  });
  const carol = await db.employee.upsert({
    where: { employeeCode: "EMP-0003" },
    create: {
      employeeCode: "EMP-0003",
      displayName: "Carol Sales",
      companyEmail: "carol@reelist8.example",
      timezone: "Asia/Manila",
      stagingAllowlisted: true,
      employmentStatus: "ACTIVE",
    },
    update: {
      displayName: "Carol Sales",
      companyEmail: "carol@reelist8.example",
      stagingAllowlisted: true,
      employmentStatus: "ACTIVE",
    },
  });

  // Link Discord identities
  await db.externalIdentity.upsert({
    where: {
      provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: "111111111111111111" },
    },
    create: {
      employeeId: alice.id,
      provider: "DISCORD",
      providerSubjectId: "111111111111111111",
      verifiedAt: new Date(),
    },
    update: { employeeId: alice.id, verifiedAt: new Date() },
  });
  await db.externalIdentity.upsert({
    where: {
      provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: "222222222222222222" },
    },
    create: {
      employeeId: bob.id,
      provider: "DISCORD",
      providerSubjectId: "222222222222222222",
      verifiedAt: new Date(),
    },
    update: { employeeId: bob.id, verifiedAt: new Date() },
  });
  await db.externalIdentity.upsert({
    where: {
      provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: "333333333333333333" },
    },
    create: {
      employeeId: carol.id,
      provider: "DISCORD",
      providerSubjectId: "333333333333333333",
      verifiedAt: new Date(),
    },
    update: { employeeId: carol.id, verifiedAt: new Date() },
  });

  // Assign roles
  await db.employeeRole.upsert({
    where: { employeeId_roleId: { employeeId: alice.id, roleId: adminRole.id } },
    create: { employeeId: alice.id, roleId: adminRole.id },
    update: {},
  });
  await db.employeeRole.upsert({
    where: { employeeId_roleId: { employeeId: bob.id, roleId: employeeRole.id } },
    create: { employeeId: bob.id, roleId: employeeRole.id },
    update: {},
  });
  await db.employeeRole.upsert({
    where: { employeeId_roleId: { employeeId: carol.id, roleId: employeeRole.id } },
    create: { employeeId: carol.id, roleId: employeeRole.id },
    update: {},
  });

  // Team memberships
  await db.employeeTeam.upsert({
    where: { employeeId_teamId: { employeeId: alice.id, teamId: engineering.id } },
    create: { employeeId: alice.id, teamId: engineering.id },
    update: {},
  });
  await db.employeeTeam.upsert({
    where: { employeeId_teamId: { employeeId: bob.id, teamId: engineering.id } },
    create: { employeeId: bob.id, teamId: engineering.id },
    update: {},
  });
  await db.employeeTeam.upsert({
    where: { employeeId_teamId: { employeeId: carol.id, teamId: sales.id } },
    create: { employeeId: carol.id, teamId: sales.id },
    update: {},
  });

  console.log(`  Employees: ${alice.displayName}, ${bob.displayName}, ${carol.displayName}`);

  // --- Projects ---
  const projectAlpha = await db.project.upsert({
    where: { key: "PROJ-ALPHA" },
    create: { key: "PROJ-ALPHA", name: "Project Alpha", status: "ACTIVE" },
    update: {},
  });
  const projectBeta = await db.project.upsert({
    where: { key: "PROJ-BETA" },
    create: { key: "PROJ-BETA", name: "Project Beta", status: "ACTIVE" },
    update: {},
  });

  await db.projectMember.upsert({
    where: { employeeId_projectId: { employeeId: alice.id, projectId: projectAlpha.id } },
    create: { employeeId: alice.id, projectId: projectAlpha.id },
    update: {},
  });
  await db.projectMember.upsert({
    where: { employeeId_projectId: { employeeId: bob.id, projectId: projectAlpha.id } },
    create: { employeeId: bob.id, projectId: projectAlpha.id },
    update: {},
  });
  await db.projectMember.upsert({
    where: { employeeId_projectId: { employeeId: carol.id, projectId: projectBeta.id } },
    create: { employeeId: carol.id, projectId: projectBeta.id },
    update: {},
  });

  console.log(`  Projects: ${projectAlpha.name}, ${projectBeta.name}`);

  // --- Authority Domains ---
  // AuthorityDomain uses `domain` as the primary key.
  await db.authorityDomain.upsert({
    where: { domain: "engineering.internal" },
    create: { domain: "engineering.internal" },
    update: {},
  });
  await db.authorityDomain.upsert({
    where: { domain: "sales.internal" },
    create: { domain: "sales.internal" },
    update: {},
  });

  // Grant DomainAuthority to Alice for engineering, Carol for sales.
  await db.domainAuthority.upsert({
    where: {
      authorityDomain_employeeId_permission: {
        authorityDomain: "engineering.internal",
        employeeId: alice.id,
        permission: "APPROVE",
      },
    },
    create: {
      authorityDomain: "engineering.internal",
      employeeId: alice.id,
      permission: "APPROVE",
    },
    update: {},
  });
  await db.domainAuthority.upsert({
    where: {
      authorityDomain_employeeId_permission: {
        authorityDomain: "sales.internal",
        employeeId: carol.id,
        permission: "APPROVE",
      },
    },
    create: {
      authorityDomain: "sales.internal",
      employeeId: carol.id,
      permission: "APPROVE",
    },
    update: {},
  });

  console.log(`  Authority domains: engineering.internal, sales.internal`);

  // --- Feature flags (all disabled by default) ---
  const flags = [
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
  ];
  for (const key of flags) {
    await db.featureFlag.upsert({
      where: { key },
      create: { key, enabled: false, updatedBy: "seed" },
      update: {},
    });
  }

  console.log(`  Feature flags: ${flags.length} (all disabled)`);

  // --- Retention policies ---
  await db.retentionPolicy.upsert({
    where: { key: "conversations" },
    create: { key: "conversations", retentionDays: 90, updatedBy: "seed" },
    update: {},
  });
  await db.retentionPolicy.upsert({
    where: { key: "audit_events" },
    create: { key: "audit_events", retentionDays: 365, updatedBy: "seed" },
    update: {},
  });
  await db.retentionPolicy.upsert({
    where: { key: "messages" },
    create: { key: "messages", retentionDays: 90, updatedBy: "seed" },
    update: {},
  });

  console.log("  Retention policies: conversations (90d), audit_events (365d), messages (90d)");

  console.log("Seed complete!");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
