import { db } from "@hermes/db";
import type { AuthorityPermission } from "@hermes/contracts";
import { audit } from "@hermes/audit";
import {
  ADMIN_MANAGEABLE_ROLES,
  STAGING_ADMIN_ROLE,
  STAGING_APPROVER_ROLE,
  STAGING_READER_ROLE,
  STAGING_REVIEW_ROLE,
  assertAdminManagementAllowed,
  getEmployeeCapabilities,
} from "./employee-access.js";

export type AdminChangeOperation =
  | "GRANT_ROLE"
  | "REVOKE_ROLE"
  | "GRANT_AUTHORITY"
  | "REVOKE_AUTHORITY";

export interface PrepareAdminChangeInput {
  requesterEmployeeId: string;
  targetEmployeeCode: string;
  operation: AdminChangeOperation;
  roleKey?: string;
  authorityDomain?: string;
  authorityPermission?: AuthorityPermission;
}

const ROLE_NAMES: Record<string, string> = {
  [STAGING_READER_ROLE]: "Staging Company Reader",
  [STAGING_REVIEW_ROLE]: "Staging SSOT Reviewer",
  [STAGING_APPROVER_ROLE]: "Staging SSOT Approver",
  [STAGING_ADMIN_ROLE]: "Staging Hermes Administrator",
};

function validateInput(input: PrepareAdminChangeInput): void {
  if (input.operation === "GRANT_ROLE" || input.operation === "REVOKE_ROLE") {
    if (!input.roleKey || !ADMIN_MANAGEABLE_ROLES.has(input.roleKey)) {
      throw new Error("staging_role_not_permitted");
    }
  }
  if (input.operation === "GRANT_AUTHORITY" || input.operation === "REVOKE_AUTHORITY") {
    if (!input.authorityDomain?.trim() || !input.authorityPermission) {
      throw new Error("authority_change_requires_domain_and_permission");
    }
  }
}

async function assertRequester(
  requesterEmployeeId: string,
  input: PrepareAdminChangeInput,
): Promise<void> {
  const capabilities = await getEmployeeCapabilities(requesterEmployeeId);
  assertAdminManagementAllowed(capabilities, {
    targetRoleKey: input.roleKey,
  });
}

export interface AdminChangeResult {
  id: string;
  status: string;
  operation: string;
  targetEmployeeId: string;
  roleKey: string | null;
  authorityDomain: string | null;
  authorityPermission: AuthorityPermission | null;
  confirmedAt?: Date | null;
}

export async function prepareAdminChange(
  input: PrepareAdminChangeInput,
): Promise<AdminChangeResult> {
  validateInput(input);
  await assertRequester(input.requesterEmployeeId, input);
  const target = await db.employee.findUnique({
    where: { employeeCode: input.targetEmployeeCode },
  });
  if (!target) throw new Error("target_employee_not_found");
  const created = await db.adminChangeRequest.create({
    data: {
      requesterEmployeeId: input.requesterEmployeeId,
      targetEmployeeId: target.id,
      operation: input.operation,
      roleKey: input.roleKey,
      authorityDomain: input.authorityDomain,
      authorityPermission: input.authorityPermission,
    },
  });
  return {
    id: created.id,
    status: created.status,
    operation: created.operation,
    targetEmployeeId: created.targetEmployeeId,
    roleKey: created.roleKey,
    authorityDomain: created.authorityDomain,
    authorityPermission: created.authorityPermission,
  };
}

export async function confirmAdminChange(
  requestId: string,
  requesterEmployeeId: string,
): Promise<AdminChangeResult> {
  const request = await db.adminChangeRequest.findUnique({ where: { id: requestId } });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId) {
    throw new Error("admin_change_not_found");
  }
  await assertRequester(requesterEmployeeId, {
    requesterEmployeeId,
    targetEmployeeCode: "",
    operation: request.operation as AdminChangeOperation,
    roleKey: request.roleKey ?? undefined,
    authorityDomain: request.authorityDomain ?? undefined,
    authorityPermission: request.authorityPermission ?? undefined,
  });
  if (request.status !== "AWAITING_CONFIRMATION") throw new Error("admin_change_not_confirmable");
  const confirmed = await db.adminChangeRequest.update({
    where: { id: requestId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  return {
    id: confirmed.id,
    status: confirmed.status,
    operation: confirmed.operation,
    targetEmployeeId: confirmed.targetEmployeeId,
    roleKey: confirmed.roleKey,
    authorityDomain: confirmed.authorityDomain,
    authorityPermission: confirmed.authorityPermission,
    confirmedAt: confirmed.confirmedAt,
  };
}

export async function executeAdminChange(requestId: string, requesterEmployeeId: string) {
  const request = await db.adminChangeRequest.findUnique({ where: { id: requestId } });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId) {
    throw new Error("admin_change_not_found");
  }
  if (request.status !== "CONFIRMED") throw new Error("admin_change_confirmation_required");
  await assertRequester(requesterEmployeeId, {
    requesterEmployeeId,
    targetEmployeeCode: "",
    operation: request.operation as AdminChangeOperation,
    roleKey: request.roleKey ?? undefined,
    authorityDomain: request.authorityDomain ?? undefined,
    authorityPermission: request.authorityPermission ?? undefined,
  });

  const target = await db.employee.findUnique({ where: { id: request.targetEmployeeId } });
  if (!target) throw new Error("target_employee_not_found");

  await db.$transaction(async (tx) => {
    if (request.operation === "GRANT_ROLE" || request.operation === "REVOKE_ROLE") {
      const roleKey = request.roleKey!;
      const role = await tx.role.upsert({
        where: { key: roleKey },
        create: { key: roleKey, name: ROLE_NAMES[roleKey] ?? roleKey },
        update: {},
      });
      if (request.operation === "GRANT_ROLE") {
        await tx.employeeRole.upsert({
          where: { employeeId_roleId: { employeeId: target.id, roleId: role.id } },
          create: { employeeId: target.id, roleId: role.id },
          update: { activeUntil: null },
        });
      } else {
        await tx.employeeRole.updateMany({
          where: { employeeId: target.id, roleId: role.id },
          data: { activeUntil: new Date() },
        });
      }
    } else {
      if (request.operation === "GRANT_AUTHORITY") {
        await tx.authorityDomain.upsert({
          where: { domain: request.authorityDomain! },
          create: {
            domain: request.authorityDomain!,
            name: `REELIST8 ${request.authorityDomain!} SSOT`,
          },
          update: {},
        });
        await tx.domainAuthority.upsert({
          where: {
            authorityDomain_employeeId_permission: {
              authorityDomain: request.authorityDomain!,
              employeeId: target.id,
              permission: request.authorityPermission!,
            },
          },
          create: {
            authorityDomain: request.authorityDomain!,
            employeeId: target.id,
            permission: request.authorityPermission!,
          },
          update: { activeUntil: null },
        });
      } else {
        await tx.domainAuthority.updateMany({
          where: {
            authorityDomain: request.authorityDomain!,
            employeeId: target.id,
            permission: request.authorityPermission!,
          },
          data: { activeUntil: new Date() },
        });
      }
    }
    await tx.adminChangeRequest.update({
      where: { id: requestId },
      data: { status: "EXECUTED", executedAt: new Date() },
    });
  });

  await audit({
    type:
      request.operation === "GRANT_ROLE"
        ? "ADMIN_ROLE_GRANTED"
        : request.operation === "REVOKE_ROLE"
          ? "ADMIN_ROLE_REVOKED"
          : request.operation === "GRANT_AUTHORITY"
            ? "ADMIN_AUTHORITY_GRANTED"
            : "ADMIN_AUTHORITY_REVOKED",
    employeeId: requesterEmployeeId,
    resourceType: "Employee",
    resourceId: target.id,
    metadata: {
      targetEmployeeCode: target.employeeCode,
      roleKey: request.roleKey,
      authorityDomain: request.authorityDomain,
      authorityPermission: request.authorityPermission,
      adminChangeRequestId: request.id,
    },
  });

  return { requestId, status: "EXECUTED", targetEmployeeCode: target.employeeCode };
}
