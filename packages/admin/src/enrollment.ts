import { db } from "@hermes/db";
import { audit } from "@hermes/audit";
import {
  ADMIN_MANAGEABLE_ROLES,
  getEmployeeCapabilities,
  getStagingRoleCapabilities,
  STAGING_ADMIN_ROLE,
  STAGING_APPROVER_ROLE,
  STAGING_READER_ROLE,
  STAGING_REVIEW_ROLE,
} from "./employee-access.js";

const ROLE_NAMES: Record<string, string> = {
  [STAGING_READER_ROLE]: "Staging Company Reader",
  [STAGING_REVIEW_ROLE]: "Staging SSOT Reviewer",
  [STAGING_APPROVER_ROLE]: "Staging SSOT Approver",
  [STAGING_ADMIN_ROLE]: "Staging Hermes Administrator",
};

export interface PrepareEnrollmentInput {
  requesterEmployeeId: string;
  fullName: string;
  companyEmail: string;
  timezone: string;
  discordUserId: string;
  employeeCode: string;
  initialRoleKeys: string[];
  stagingAllowlisted?: boolean;
}

export interface EnrollmentSummary {
  id: string;
  status: string;
  fullName: string;
  companyEmail: string;
  timezone: string;
  discordUserIdSuffix: string;
  employeeCode: string;
  initialRoleKeys: string[];
  stagingAllowlisted: boolean;
}

function validateDiscordId(value: string): void {
  if (!/^\d{17,20}$/.test(value)) throw new Error("invalid_discord_user_id");
}

function validateEmail(value: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("invalid_company_email");
}

function validateTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error("invalid_timezone");
  }
}

function validateEmployeeCode(value: string): void {
  if (!/^RL8-EMP-\d{4}$/.test(value)) throw new Error("approved_employee_code_required");
}

function validateRoles(roleKeys: string[]): void {
  if (!roleKeys.length) throw new Error("initial_role_required");
  if (new Set(roleKeys).size !== roleKeys.length) throw new Error("duplicate_initial_role");
  for (const roleKey of roleKeys) {
    if (!ADMIN_MANAGEABLE_ROLES.has(roleKey)) throw new Error("invalid_initial_role");
  }
}

async function assertEnrollmentRequester(
  requesterEmployeeId: string,
  roleKeys: string[],
): Promise<void> {
  const capabilities = await getEmployeeCapabilities(requesterEmployeeId);
  if (!capabilities.has("EMPLOYEE_ENROLL")) throw new Error("employee_enroll_capability_required");
  if (roleKeys.includes(STAGING_ADMIN_ROLE) && !capabilities.has("HERMES_ADMIN")) {
    throw new Error("admin_capability_required_for_admin_role");
  }
}

async function assertNoDuplicates(input: PrepareEnrollmentInput): Promise<void> {
  const [identity, code, email] = await Promise.all([
    db.externalIdentity.findUnique({
      where: {
        provider_providerSubjectId: { provider: "DISCORD", providerSubjectId: input.discordUserId },
      },
    }),
    db.employee.findUnique({ where: { employeeCode: input.employeeCode } }),
    db.employee.findUnique({ where: { companyEmail: input.companyEmail } }),
  ]);
  if (identity) throw new Error("discord_identity_already_linked");
  if (code || email) throw new Error("existing_employee_link_required");
}

function toSummary(request: {
  id: string;
  status: string;
  fullName: string;
  companyEmail: string;
  timezone: string;
  discordUserId: string;
  employeeCode: string;
  initialRoleKeys: string[];
  stagingAllowlisted: boolean;
}): EnrollmentSummary {
  return {
    id: request.id,
    status: request.status,
    fullName: request.fullName,
    companyEmail: request.companyEmail,
    timezone: request.timezone,
    discordUserIdSuffix: request.discordUserId.slice(-4),
    employeeCode: request.employeeCode,
    initialRoleKeys: request.initialRoleKeys,
    stagingAllowlisted: request.stagingAllowlisted,
  };
}

export async function prepareEmployeeEnrollment(
  input: PrepareEnrollmentInput,
): Promise<EnrollmentSummary> {
  const normalized = {
    ...input,
    fullName: input.fullName.trim(),
    companyEmail: input.companyEmail.trim().toLowerCase(),
    timezone: input.timezone.trim(),
    discordUserId: input.discordUserId.trim(),
    employeeCode: input.employeeCode.trim(),
    initialRoleKeys: [...input.initialRoleKeys].map((value) => value.trim()),
  };
  if (!normalized.fullName) throw new Error("full_name_required");
  validateEmail(normalized.companyEmail);
  validateTimezone(normalized.timezone);
  validateDiscordId(normalized.discordUserId);
  validateEmployeeCode(normalized.employeeCode);
  validateRoles(normalized.initialRoleKeys);
  await assertEnrollmentRequester(normalized.requesterEmployeeId, normalized.initialRoleKeys);
  await assertNoDuplicates(normalized);
  const request = await db.employeeEnrollmentRequest.create({
    data: {
      requesterEmployeeId: normalized.requesterEmployeeId,
      fullName: normalized.fullName,
      companyEmail: normalized.companyEmail,
      timezone: normalized.timezone,
      discordUserId: normalized.discordUserId,
      employeeCode: normalized.employeeCode,
      initialRoleKeys: normalized.initialRoleKeys,
      stagingAllowlisted: normalized.stagingAllowlisted ?? false,
    },
  });
  return toSummary(request);
}

export async function confirmEmployeeEnrollment(
  requestId: string,
  requesterEmployeeId: string,
): Promise<EnrollmentSummary> {
  const request = await db.employeeEnrollmentRequest.findUnique({ where: { id: requestId } });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("enrollment_not_found");
  await assertEnrollmentRequester(requesterEmployeeId, request.initialRoleKeys);
  if (request.status !== "AWAITING_CONFIRMATION") throw new Error("enrollment_not_confirmable");
  const confirmed = await db.employeeEnrollmentRequest.update({
    where: { id: requestId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
  });
  return toSummary(confirmed);
}

export async function getEmployeeEnrollment(
  requestId: string,
  requesterEmployeeId: string,
): Promise<EnrollmentSummary> {
  const request = await db.employeeEnrollmentRequest.findUnique({ where: { id: requestId } });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("enrollment_not_found");
  return toSummary(request);
}

export async function cancelEmployeeEnrollment(
  requestId: string,
  requesterEmployeeId: string,
): Promise<EnrollmentSummary> {
  const request = await db.employeeEnrollmentRequest.findUnique({ where: { id: requestId } });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("enrollment_not_found");
  if (request.status === "EXECUTED") throw new Error("enrollment_already_executed");
  const cancelled = await db.employeeEnrollmentRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  return toSummary(cancelled);
}

export async function prepareEmployeeIdentityLink(input: {
  requesterEmployeeId: string;
  employeeCode: string;
  discordUserId: string;
}): Promise<EnrollmentSummary> {
  validateDiscordId(input.discordUserId.trim());
  validateEmployeeCode(input.employeeCode.trim());
  await assertEnrollmentRequester(input.requesterEmployeeId, []);
  const employee = await db.employee.findUnique({
    where: { employeeCode: input.employeeCode.trim() },
  });
  if (!employee) throw new Error("employee_not_found_for_identity_link");
  const identity = await db.externalIdentity.findUnique({
    where: {
      provider_providerSubjectId: {
        provider: "DISCORD",
        providerSubjectId: input.discordUserId.trim(),
      },
    },
  });
  if (identity) throw new Error("discord_identity_already_linked");
  const request = await db.employeeEnrollmentRequest.create({
    data: {
      requesterEmployeeId: input.requesterEmployeeId,
      existingEmployeeId: employee.id,
      mode: "LINK",
      fullName: employee.displayName,
      companyEmail: employee.companyEmail,
      timezone: employee.timezone,
      discordUserId: input.discordUserId.trim(),
      employeeCode: employee.employeeCode,
      initialRoleKeys: [],
      stagingAllowlisted: employee.stagingAllowlisted,
    },
  });
  return toSummary(request);
}
export async function executeEmployeeEnrollment(requestId: string, requesterEmployeeId: string) {
  const request = await db.employeeEnrollmentRequest.findUnique({ where: { id: requestId } });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("enrollment_not_found");
  if (request.status !== "CONFIRMED") throw new Error("enrollment_confirmation_required");
  await assertEnrollmentRequester(requesterEmployeeId, request.initialRoleKeys);

  const employee = await db.$transaction(async (tx) => {
    const duplicateIdentity = await tx.externalIdentity.findUnique({
      where: {
        provider_providerSubjectId: {
          provider: "DISCORD",
          providerSubjectId: request.discordUserId,
        },
      },
    });
    const duplicateCode = await tx.employee.findUnique({
      where: { employeeCode: request.employeeCode },
    });
    const duplicateEmail = await tx.employee.findUnique({
      where: { companyEmail: request.companyEmail },
    });
    if (duplicateIdentity) throw new Error("discord_identity_already_linked");
    if (request.mode === "LINK") {
      if (!request.existingEmployeeId) throw new Error("existing_employee_link_target_missing");
      const existing = await tx.employee.findUnique({ where: { id: request.existingEmployeeId } });
      if (!existing) throw new Error("employee_not_found_for_identity_link");
      await tx.externalIdentity.create({
        data: {
          employeeId: existing.id,
          provider: "DISCORD",
          providerSubjectId: request.discordUserId,
          verifiedAt: new Date(),
        },
      });
      await tx.employeeEnrollmentRequest.update({
        where: { id: request.id },
        data: { status: "EXECUTED", executedAt: new Date() },
      });
      return existing;
    }
    if (duplicateCode || duplicateEmail) throw new Error("existing_employee_link_required");

    const created = await tx.employee.create({
      data: {
        employeeCode: request.employeeCode,
        displayName: request.fullName,
        companyEmail: request.companyEmail,
        timezone: request.timezone,
        stagingAllowlisted: request.stagingAllowlisted,
        employmentStatus: "ACTIVE",
      },
    });
    await tx.externalIdentity.create({
      data: {
        employeeId: created.id,
        provider: "DISCORD",
        providerSubjectId: request.discordUserId,
        verifiedAt: new Date(),
      },
    });
    for (const roleKey of request.initialRoleKeys) {
      const role = await tx.role.upsert({
        where: { key: roleKey },
        create: { key: roleKey, name: ROLE_NAMES[roleKey] ?? roleKey },
        update: {},
      });
      const capabilities = getStagingRoleCapabilities(roleKey);
      if (!capabilities) throw new Error("invalid_initial_role");
      for (const capability of capabilities) {
        await tx.roleCapability.upsert({
          where: { roleId_capability: { roleId: role.id, capability } },
          create: { roleId: role.id, capability },
          update: {},
        });
      }
      await tx.employeeRole.create({ data: { employeeId: created.id, roleId: role.id } });
    }
    await tx.employeeEnrollmentRequest.update({
      where: { id: request.id },
      data: { status: "EXECUTED", executedAt: new Date() },
    });
    return created;
  });

  await audit({
    type: request.mode === "LINK" ? "EMPLOYEE_IDENTITY_LINKED" : "EMPLOYEE_ENROLLED",
    employeeId: requesterEmployeeId,
    resourceType: "Employee",
    resourceId: employee.id,
    metadata: {
      requestingAdminEmployeeId: requesterEmployeeId,
      newEmployeeId: employee.id,
      discordIdentitySuffix: request.discordUserId.slice(-4),
      employeeCode: employee.employeeCode,
      assignedRoles: request.initialRoleKeys,
      stagingAllowlisted: request.stagingAllowlisted,
      enrollmentRequestId: request.id,
    },
  });
  return {
    requestId,
    status: "EXECUTED",
    employeeId: employee.id,
    employeeCode: employee.employeeCode,
  };
}
