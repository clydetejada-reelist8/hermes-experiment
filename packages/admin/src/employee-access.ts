import { URL } from "node:url";
import { db } from "@hermes/db";
import type { Capability } from "@hermes/contracts";
import { audit } from "@hermes/audit";

export const STAGING_ADMIN_ROLE = "staging-hermes-admin";
export const STAGING_REVIEW_ROLE = "staging-ssot-reviewer";
export const STAGING_APPROVER_ROLE = "staging-ssot-approver";
export const STAGING_READER_ROLE = "staging-company-reader";
export const STAGING_PROFILE_CORRECTOR_ROLE = "staging-employee-profile-admin";

export const ADMIN_MANAGEABLE_ROLES = new Set([
  STAGING_REVIEW_ROLE,
  STAGING_APPROVER_ROLE,
  STAGING_READER_ROLE,
  STAGING_ADMIN_ROLE,
  STAGING_PROFILE_CORRECTOR_ROLE,
]);

export function assertStagingBootstrapEnvironment(input: {
  allowFlag: string | undefined;
  databaseUrl: string | undefined;
}): void {
  if (input.allowFlag !== "1") throw new Error("staging_bootstrap_flag_required");
  const databaseName = input.databaseUrl
    ? new URL(input.databaseUrl).pathname.replace(/^\//, "")
    : "";
  if (databaseName !== "hermes_staging") throw new Error("staging_database_required");
}

export function assertAdminManagementAllowed(
  capabilities: Set<string>,
  change?: { targetIsRequester?: boolean; targetRoleKey?: string },
): void {
  if (!capabilities.has("HERMES_ADMIN")) throw new Error("admin_capability_required");
  if (change?.targetRoleKey && !ADMIN_MANAGEABLE_ROLES.has(change.targetRoleKey)) {
    throw new Error("staging_role_not_permitted");
  }
}

export function assertAdminPrivilegeConfirmation(confirmed: boolean): void {
  if (!confirmed) throw new Error("admin_escalation_confirmation_required");
}

function assertKnownCapability(capability: string): asserts capability is Capability {
  const known: Capability[] = [
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
  ];
  if (!known.includes(capability as Capability))
    throw new Error(`unknown_capability:${capability}`);
}

async function upsertRole(key: string, name: string, capabilities: string[]) {
  const role = await db.role.upsert({
    where: { key },
    create: { key, name },
    update: { name },
  });
  for (const capability of capabilities) {
    assertKnownCapability(capability);
    await db.roleCapability.upsert({
      where: { roleId_capability: { roleId: role.id, capability } },
      create: { roleId: role.id, capability },
      update: {},
    });
  }
  return role;
}

async function upsertStagingRole(roleKey: string) {
  const capabilities = getStagingRoleCapabilities(roleKey);
  if (!capabilities) throw new Error("invalid_staging_role");
  return upsertRole(roleKey, STAGING_ROLE_NAMES[roleKey] ?? roleKey, capabilities);
}

async function attachRole(employeeId: string, roleId: string) {
  await db.employeeRole.upsert({
    where: { employeeId_roleId: { employeeId, roleId } },
    create: { employeeId, roleId },
    update: { activeUntil: null },
  });
}

export interface StagingOwnerBootstrapInput {
  employeeCode: string;
  discordUserId: string;
  authorityDomain: string;
  allowFlag?: string;
  databaseUrl?: string;
}

export async function bootstrapStagingOwner(input: StagingOwnerBootstrapInput) {
  assertStagingBootstrapEnvironment({
    allowFlag: input.allowFlag ?? process.env.HERMES_ALLOW_STAGING_OWNER_BOOTSTRAP,
    databaseUrl: input.databaseUrl ?? process.env.DATABASE_URL,
  });

  const employee = await db.employee.findUnique({ where: { employeeCode: input.employeeCode } });
  if (!employee) throw new Error("employee_not_found");
  const identity = await db.externalIdentity.findUnique({
    where: {
      provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: input.discordUserId },
    },
  });
  if (!identity) throw new Error("discord_identity_not_found");
  if (identity.employeeId !== employee.id) throw new Error("discord_identity_employee_mismatch");

  const [adminRole, reviewRole, approverRole, profileRole] = await Promise.all([
    upsertStagingRole(STAGING_ADMIN_ROLE),
    upsertStagingRole(STAGING_REVIEW_ROLE),
    upsertStagingRole(STAGING_APPROVER_ROLE),
    upsertStagingRole(STAGING_PROFILE_CORRECTOR_ROLE),
  ]);
  await Promise.all([
    attachRole(employee.id, adminRole.id),
    attachRole(employee.id, reviewRole.id),
    attachRole(employee.id, approverRole.id),
    attachRole(employee.id, profileRole.id),
  ]);

  await db.authorityDomain.upsert({
    where: { domain: input.authorityDomain },
    create: { domain: input.authorityDomain, name: `REELIST8 ${input.authorityDomain} SSOT` },
    update: {},
  });
  for (const permission of ["REVIEW", "APPROVE"] as const) {
    await db.domainAuthority.upsert({
      where: {
        authorityDomain_employeeId_permission: {
          authorityDomain: input.authorityDomain,
          employeeId: employee.id,
          permission,
        },
      },
      create: { authorityDomain: input.authorityDomain, employeeId: employee.id, permission },
      update: { activeUntil: null },
    });
  }

  await audit({
    type: "ADMIN_BOOTSTRAP",
    employeeId: employee.id,
    resourceType: "Employee",
    resourceId: employee.id,
    metadata: {
      employeeCode: employee.employeeCode,
      authorityDomain: input.authorityDomain,
      source: "guarded_staging_owner_bootstrap",
    },
  });

  return {
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
    authorityDomain: input.authorityDomain,
  };
}

export async function getEmployeeCapabilities(employeeId: string): Promise<Set<Capability>> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      employeeRoles: {
        where: { OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }] },
        include: { role: { include: { capabilities: true } } },
      },
    },
  });
  if (!employee) throw new Error("employee_not_found");
  return new Set(
    employee.employeeRoles.flatMap((membership) =>
      membership.role.capabilities.map((entry) => entry.capability),
    ),
  );
}
