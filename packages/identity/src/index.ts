import { db } from "@hermes/db";
import type { Employee, EmployeeProfile } from "./types.js";
import { IdentityDeniedError } from "./types.js";

export type { Employee, EmployeeProfile, IdentityDenialReason } from "./types.js";
export { IdentityDeniedError } from "./types.js";

/**
 * Resolve a Discord user ID to the canonical REELIST8 Employee through the
 * `ExternalIdentity(provider=DISCORD)` mapping.
 *
 * Authorization is never based on username, nickname, email typed into a
 * prompt, or display name. Only the verified Discord user ID -> Employee link
 * is used.
 */
export async function resolveDiscordEmployee(discordUserId: string): Promise<Employee> {
  const identity = await db.externalIdentity.findUnique({
    where: {
      provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: discordUserId },
    },
    include: { employee: true },
  });

  if (!identity) {
    throw new IdentityDeniedError("IDENTITY_NOT_FOUND");
  }

  return assertStagingEmployee(identity.employee);
}

interface ProfileEmployee extends Employee {
  manager: { displayName: string } | null;
  employeeRoles: Array<{
    role: { name: string; capabilities: Array<{ capability: string }> };
  }>;
  employeeTeams: Array<{ team: { name: string } }>;
  projectMemberships: Array<{ project: { name: string } }>;
  externalIdentities: Array<{ provider: string; providerSubjectId: string }>;
}

/** Resolve a Discord caller and load the safe directory/profile context. */
export async function resolveDiscordEmployeeProfile(
  discordUserId: string,
): Promise<{ employee: Employee; profile: EmployeeProfile }> {
  const identity = await db.externalIdentity.findUnique({
    where: {
      provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: discordUserId },
    },
    include: {
      employee: {
        include: {
          manager: true,
          employeeRoles: {
            where: {
              activeFrom: { lte: new Date() },
              OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }],
            },
            include: { role: { include: { capabilities: true } } },
          },
          employeeTeams: { include: { team: true } },
          projectMemberships: { include: { project: true } },
          externalIdentities: true,
        },
      },
    },
  });

  if (!identity) throw new IdentityDeniedError("IDENTITY_NOT_FOUND");
  assertStagingEmployee(identity.employee);
  const employee = identity.employee as unknown as ProfileEmployee;
  return {
    employee,
    profile: {
      company: "REELIST8",
      roles: employee.employeeRoles.map((membership) => membership.role.name),
      teams: employee.employeeTeams.map((membership) => membership.team.name),
      projects: employee.projectMemberships.map((membership) => membership.project.name),
      manager: employee.manager?.displayName ?? null,
      capabilities: employee.employeeRoles.flatMap((membership) =>
        membership.role.capabilities.map((capability) => capability.capability),
      ),
      linkedIdentities: employee.externalIdentities.map((linked) => ({
        provider: linked.provider,
        subjectId: linked.providerSubjectId,
      })),
    },
  };
}

/**
 * Require that an employee (by canonical id) is active and staging-allowlisted.
 */
export async function requireActiveStagingEmployee(employeeId: string): Promise<Employee> {
  const employee = await db.employee.findUnique({ where: { id: employeeId } });
  if (!employee) {
    throw new IdentityDeniedError("IDENTITY_NOT_FOUND");
  }
  return assertStagingEmployee(employee);
}

function assertStagingEmployee(employee: Employee): Employee {
  if (employee.employmentStatus !== "ACTIVE") {
    throw new IdentityDeniedError("EMPLOYEE_INACTIVE");
  }
  if (!employee.stagingAllowlisted) {
    throw new IdentityDeniedError("NOT_ALLOWLISTED");
  }
  return employee;
}
