import { db } from "@hermes/db";
import { randomUUID } from "node:crypto";

/**
 * Minimal fixture builders for schema/integration tests. Each builder returns
 * a created record and is safe to call repeatedly (unique random keys).
 */
export async function createEmployee(
  overrides: Partial<{
    employeeCode: string;
    displayName: string;
    companyEmail: string;
    timezone: string;
    stagingAllowlisted: boolean;
  }> = {},
) {
  const id = randomUUID();
  const suffix = id.slice(0, 8);
  return db.employee.create({
    data: {
      id,
      employeeCode: overrides.employeeCode ?? `EMP-${suffix}`,
      displayName: overrides.displayName ?? `Test ${suffix}`,
      companyEmail: overrides.companyEmail ?? `test-${suffix}@reelist8.example`,
      timezone: overrides.timezone ?? "Asia/Manila",
      employmentStatus: "ACTIVE",
      stagingAllowlisted: overrides.stagingAllowlisted ?? true,
    },
  });
}

export async function createDiscordIdentity(employeeId: string, discordId?: string) {
  return db.externalIdentity.create({
    data: {
      employeeId,
      provider: "DISCORD",
      providerSubjectId: discordId ?? randomUUID(),
    },
  });
}

export async function createRole(key?: string) {
  return db.role.create({
    data: { key: key ?? `role-${randomUUID().slice(0, 8)}`, name: "Test role" },
  });
}

export async function createProject(key?: string) {
  return db.project.create({
    data: {
      key: key ?? `PROJ-${randomUUID().slice(0, 6)}`,
      name: "Test project",
      status: "ACTIVE",
    },
  });
}

export async function createTeam(name?: string) {
  return db.team.create({ data: { name: name ?? `Team ${randomUUID().slice(0, 6)}` } });
}
