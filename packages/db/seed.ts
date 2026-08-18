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
    where: { name: "admin" },
    create: { name: "admin" },
    update: {},
  });
  const employeeRole = await db.role.upsert({
    where: { name: "employee" },
    create: { name: "employee" },
    update: {},
  });
  const viewerRole = await db.role.upsert({
    where: { name: "viewer" },
    create: { name: "viewer" },
    update: {},
  });

  // Role capabilities
  const adminCaps = [
    "action.execute.high_risk",
    "action.execute.medium_risk",
    "action.execute.low_risk",
    "ssot.propose",
    "ssot.review",
    "ssot.approve",
    "admin.flags",
    "admin.killswitch",
    "admin.retention",
  ];
  const employeeCaps = ["action.execute.medium_risk", "action.execute.low_risk", "ssot.propose"];
  const viewerCaps = ["action.execute.low_risk"];

  for (const cap of adminCaps) {
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: adminRole.id, capability: cap } },
      create: { roleId: adminRole.id, capability: cap },
      update: {},
    });
  }
  for (const cap of employeeCaps) {
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: employeeRole.id, capability: cap } },
      create: { roleId: employeeRole.id, capability: cap },
      update: {},
    });
  }
  for (const cap of viewerCaps) {
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: viewerRole.id, capability: cap } },
      create: { roleId: viewerRole.id, capability: cap },
      update: {},
    });
  }

  console.log(`  Roles: ${adminRole.name}, ${employeeRole.name}, ${viewerRole.name}`);

  // --- Employees ---
  const alice = await db.employee.upsert({
    where: { discordId: "111111111111111111" },
    create: {
      discordId: "111111111111111111",
      discordUsername: "alice_admin",
      displayName: "Alice Admin",
    },
    update: { discordUsername: "alice_admin", displayName: "Alice Admin" },
  });
  const bob = await db.employee.upsert({
    where: { discordId: "222222222222222222" },
    create: {
      discordId: "222222222222222222",
      discordUsername: "bob_engineer",
      displayName: "Bob Engineer",
    },
    update: { discordUsername: "bob_engineer", displayName: "Bob Engineer" },
  });
  const carol = await db.employee.upsert({
    where: { discordId: "333333333333333333" },
    create: {
      discordId: "333333333333333333",
      discordUsername: "carol_sales",
      displayName: "Carol Sales",
    },
    update: { discordUsername: "carol_sales", displayName: "Carol Sales" },
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
    where: { name: "Project Alpha" },
    create: { name: "Project Alpha", description: "Main product development" },
    update: {},
  });
  const projectBeta = await db.project.upsert({
    where: { name: "Project Beta" },
    create: { name: "Project Beta", description: "Internal tooling" },
    update: {},
  });

  await db.projectMember.upsert({
    where: { projectId_employeeId: { projectId: projectAlpha.id, employeeId: alice.id } },
    create: { projectId: projectAlpha.id, employeeId: alice.id },
    update: {},
  });
  await db.projectMember.upsert({
    where: { projectId_employeeId: { projectId: projectAlpha.id, employeeId: bob.id } },
    create: { projectId: projectAlpha.id, employeeId: bob.id },
    update: {},
  });
  await db.projectMember.upsert({
    where: { projectId_employeeId: { projectId: projectBeta.id, employeeId: carol.id } },
    create: { projectId: projectBeta.id, employeeId: carol.id },
    update: {},
  });

  console.log(`  Projects: ${projectAlpha.name}, ${projectBeta.name}`);

  // --- Authority Domains ---
  const engineeringDomain = await db.authorityDomain.upsert({
    where: { domain: "engineering.internal" },
    create: {
      domain: "engineering.internal",
      description: "Engineering decisions and technical standards",
      ownerEmployeeId: alice.id,
    },
    update: {},
  });
  const salesDomain = await db.authorityDomain.upsert({
    where: { domain: "sales.internal" },
    create: {
      domain: "sales.internal",
      description: "Sales processes and customer relationships",
      ownerEmployeeId: carol.id,
    },
    update: {},
  });

  console.log(`  Authority domains: ${engineeringDomain.domain}, ${salesDomain.domain}`);

  // --- Feature flags (all disabled by default) ---
  const flags = [
    "gmail_actions",
    "calendar_actions",
    "reminders",
    "ssot_proposals",
    "contradiction_detection",
    "nl_action_proposals",
    "source_sync",
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
