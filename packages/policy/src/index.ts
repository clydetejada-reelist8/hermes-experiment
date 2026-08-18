import { db } from "@hermes/db";
import type { ArtifactScope, Capability, PolicyDecision } from "@hermes/contracts";
import { allow, deny } from "@hermes/contracts";

export type { PolicyDecision } from "@hermes/contracts";

/**
 * Deterministic Hermes policy engine.
 *
 * All authorization decisions are made here — never by the model. The engine
 * is pure DB-backed: it reads Employee + Role + RoleCapability + membership
 * rows and returns a {@link PolicyDecision}. No model output can grant a
 * capability or override a denial.
 */

interface EmployeeAuthState {
  id: string;
  employmentStatus: string;
  stagingAllowlisted: boolean;
  capabilities: Set<Capability>;
}

async function loadEmployeeAuth(employeeId: string): Promise<EmployeeAuthState | null> {
  const emp = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      employeeRoles: {
        where: {
          OR: [{ activeUntil: null }, { activeUntil: { gt: new Date() } }],
        },
        include: { role: { include: { capabilities: true } } },
      },
    },
  });
  if (!emp) return null;
  const capabilities = new Set<Capability>();
  for (const er of emp.employeeRoles) {
    for (const rc of er.role.capabilities) {
      capabilities.add(rc.capability);
    }
  }
  return {
    id: emp.id,
    employmentStatus: emp.employmentStatus,
    stagingAllowlisted: emp.stagingAllowlisted,
    capabilities,
  };
}

function baseDecision(state: EmployeeAuthState | null): PolicyDecision | null {
  if (!state) return deny("EMPLOYEE_INACTIVE");
  if (state.employmentStatus !== "ACTIVE") return deny("EMPLOYEE_INACTIVE");
  if (!state.stagingAllowlisted) return deny("NOT_ALLOWLISTED");
  return null;
}

/**
 * Evaluate whether an employee holds a single capability. Checks employment
 * status and allowlist first, then capability membership.
 */
export async function evaluateCapability(
  employeeId: string,
  capability: Capability,
): Promise<PolicyDecision> {
  const state = await loadEmployeeAuth(employeeId);
  const base = baseDecision(state);
  if (base) return base;
  if (!state!.capabilities.has(capability)) return deny("MISSING_CAPABILITY");
  return allow();
}

export interface ScopeRequest {
  employeeId: string;
  scope: ArtifactScope;
  ownerEmployeeId?: string;
  teamId?: string;
  projectId?: string;
  capability: Capability;
}

/**
 * Evaluate a Hermes-scope read request. Combines the capability check with a
 * deterministic audience-membership check:
 *   - PERSONAL: only the owner employee can read.
 *   - TEAM: only members of the owning team can read.
 *   - PROJECT: only members of the owning project can read.
 *   - COMPANY: any active allowlisted employee with the company capability.
 *   - THREAD_ONLY: treated as PERSONAL (only the owner).
 */
export async function evaluateHermesScope(req: ScopeRequest): Promise<PolicyDecision> {
  const state = await loadEmployeeAuth(req.employeeId);
  const base = baseDecision(state);
  if (base) return base;
  if (!state!.capabilities.has(req.capability)) return deny("MISSING_CAPABILITY");

  switch (req.scope) {
    case "PERSONAL":
    case "THREAD_ONLY":
      if (req.ownerEmployeeId && req.ownerEmployeeId !== req.employeeId) {
        return deny("AUDIENCE_DENIED");
      }
      return allow();

    case "TEAM": {
      if (!req.teamId) return deny("AUDIENCE_DENIED");
      const membership = await db.employeeTeam.findUnique({
        where: {
          employeeId_teamId: { employeeId: req.employeeId, teamId: req.teamId },
        },
      });
      if (!membership) return deny("AUDIENCE_DENIED");
      return allow();
    }

    case "PROJECT": {
      if (!req.projectId) return deny("AUDIENCE_DENIED");
      const membership = await db.projectMember.findUnique({
        where: {
          employeeId_projectId: { employeeId: req.employeeId, projectId: req.projectId },
        },
      });
      if (!membership) return deny("AUDIENCE_DENIED");
      return allow();
    }

    case "COMPANY":
      return allow();

    default:
      return deny("AUDIENCE_DENIED");
  }
}
