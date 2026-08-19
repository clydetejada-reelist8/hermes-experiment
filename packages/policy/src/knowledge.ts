import { db } from "@hermes/db";
import type { Capability } from "@hermes/contracts";

export interface KnowledgeAccessContext {
  employeeId: string;
  teamIds: string[];
  projectIds: string[];
  capabilities: Set<Capability>;
}

export class KnowledgeAccessDeniedError extends Error {
  constructor(public readonly reason: "EMPLOYEE_INACTIVE" | "NOT_ALLOWLISTED" | "EMPLOYEE_NOT_FOUND") {
    super(`knowledge_access_denied:${reason}`);
    this.name = "KnowledgeAccessDeniedError";
  }
}

/**
 * Load the complete deterministic access context used by every knowledge
 * retrieval implementation. Callers must use the returned capabilities and
 * memberships when constructing their SQL visibility predicate.
 */
export async function getKnowledgeAccessContext(employeeId: string): Promise<KnowledgeAccessContext> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      employeeRoles: {
        where: {
          activeFrom: { lte: new Date() },
          OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }],
        },
        include: { role: { include: { capabilities: true } } },
      },
      employeeTeams: { select: { teamId: true } },
      projectMemberships: { select: { projectId: true } },
    },
  });

  if (!employee) throw new KnowledgeAccessDeniedError("EMPLOYEE_NOT_FOUND");
  if (employee.employmentStatus !== "ACTIVE")
    throw new KnowledgeAccessDeniedError("EMPLOYEE_INACTIVE");
  if (!employee.stagingAllowlisted) throw new KnowledgeAccessDeniedError("NOT_ALLOWLISTED");

  const capabilities = new Set<Capability>();
  for (const employeeRole of employee.employeeRoles) {
    for (const roleCapability of employeeRole.role.capabilities) {
      capabilities.add(roleCapability.capability);
    }
  }

  return {
    employeeId,
    teamIds: employee.employeeTeams.map((membership) => membership.teamId),
    projectIds: employee.projectMemberships.map((membership) => membership.projectId),
    capabilities,
  };
}

export function hasKnowledgeCapability(
  context: KnowledgeAccessContext,
  capability: Capability,
): boolean {
  return context.capabilities.has(capability);
}
