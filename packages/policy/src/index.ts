import { db } from "@hermes/db";
import type { ActionType, ArtifactScope, Capability, PolicyDecision } from "@hermes/contracts";
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

/**
 * Map an action type to the capability required to prepare/execute it.
 */
const ACTION_CAPABILITY: Record<ActionType, Capability> = {
  GMAIL_CREATE_DRAFT: "GMAIL_DRAFT",
  GMAIL_UPDATE_DRAFT: "GMAIL_DRAFT",
  GMAIL_SEND_DRAFT: "GMAIL_SEND",
  CALENDAR_FREEBUSY: "CALENDAR_FREEBUSY",
  CALENDAR_CREATE_PERSONAL_EVENT: "CALENDAR_CREATE_PERSONAL_EVENT",
  CALENDAR_CREATE_MEETING: "CALENDAR_INVITE_OTHERS",
  CALENDAR_UPDATE_EVENT: "CALENDAR_UPDATE_EVENT",
  CALENDAR_CANCEL_EVENT: "CALENDAR_CANCEL_EVENT",
  REMINDER_CREATE: "MEMORY_WRITE_OWN",
  REMINDER_COMPLETE: "MEMORY_WRITE_OWN",
  REMINDER_DELETE: "MEMORY_WRITE_OWN",
};

/**
 * Check whether an employee can prepare an action of the given type. This is a
 * capability check: the employee must hold the capability mapped to the action
 * type (and be an active, allowlisted employee).
 */
export async function canPrepareAction(
  employeeId: string,
  actionType: ActionType,
): Promise<PolicyDecision> {
  const capability = ACTION_CAPABILITY[actionType];
  return evaluateCapability(employeeId, capability);
}

/**
 * Check whether an employee can execute an action of the given type with the
 * supplied parameters. Calls {@link canPrepareAction} first, then applies
 * parameter-specific checks (e.g. recipient allowlist for GMAIL_SEND_DRAFT).
 */
export async function canExecuteAction(
  employeeId: string,
  actionType: ActionType,
  parameters: Record<string, unknown>,
): Promise<PolicyDecision> {
  const base = await canPrepareAction(employeeId, actionType);
  if (!base.allowed) return base;

  if (actionType === "GMAIL_SEND_DRAFT") {
    const allowlistRaw = process.env.STAGING_EMAIL_RECIPIENT_ALLOWLIST;
    if (allowlistRaw) {
      const allowlist = new Set(
        allowlistRaw
          .split(",")
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      );
      const to = typeof parameters.to === "string" ? parameters.to : "";
      const recipient = to.trim().toLowerCase();
      if (recipient && !allowlist.has(recipient)) {
        return deny("RECIPIENT_NOT_ALLOWLISTED");
      }
    }
  }

  return allow();
}

/**
 * Deterministically determine whether an action type (with optional
 * parameters) requires human confirmation before execution. The model cannot
 * override this.
 */
export function requiresConfirmation(
  actionType: ActionType,
  _parameters?: Record<string, unknown>,
): boolean {
  switch (actionType) {
    case "GMAIL_SEND_DRAFT":
    case "CALENDAR_CREATE_MEETING":
    case "CALENDAR_CANCEL_EVENT":
    case "CALENDAR_UPDATE_EVENT":
      return true;
    default:
      return false;
  }
}
