import { db } from "@hermes/db";
import type { Employee } from "./types.js";
import { IdentityDeniedError } from "./types.js";

export type { Employee, IdentityDenialReason } from "./types.js";
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
