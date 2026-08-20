import { db } from "@hermes/db";
import { audit } from "@hermes/audit";
import { getEmployeeCapabilities } from "./employee-access.js";

export const STAGING_PROFILE_CORRECTOR_ROLE = "staging-employee-profile-admin";

export function assertProfileCorrectionAllowed(capabilities: Set<string>): void {
  if (!capabilities.has("EMPLOYEE_PROFILE_CORRECT")) {
    throw new Error("employee_profile_correction_capability_required");
  }
}

export function assertDisplayNameChange(currentName: string, newName: string): void {
  const normalized = newName.trim();
  if (!normalized) throw new Error("display_name_required");
  if (normalized === currentName.trim()) throw new Error("display_name_unchanged");
}

export interface ProfileCorrectionSummary {
  id: string;
  status: string;
  employeeCode: string;
  oldDisplayName: string;
  newDisplayName: string;
  confirmedAt?: Date | null;
}

function summary(request: {
  id: string;
  status: string;
  oldDisplayName: string;
  newDisplayName: string;
  confirmedAt?: Date | null;
  target: { employeeCode: string };
}): ProfileCorrectionSummary {
  return {
    id: request.id,
    status: request.status,
    employeeCode: request.target.employeeCode,
    oldDisplayName: request.oldDisplayName,
    newDisplayName: request.newDisplayName,
    confirmedAt: request.confirmedAt,
  };
}

async function assertRequester(requesterEmployeeId: string): Promise<void> {
  assertProfileCorrectionAllowed(await getEmployeeCapabilities(requesterEmployeeId));
}

export async function prepareProfileCorrection(input: {
  requesterEmployeeId: string;
  targetEmployeeCode: string;
  newDisplayName: string;
}): Promise<ProfileCorrectionSummary> {
  await assertRequester(input.requesterEmployeeId);
  const target = await db.employee.findUnique({
    where: { employeeCode: input.targetEmployeeCode.trim() },
  });
  if (!target) throw new Error("target_employee_not_found");
  assertDisplayNameChange(target.displayName, input.newDisplayName);
  const request = await db.employeeProfileCorrectionRequest.create({
    data: {
      requesterEmployeeId: input.requesterEmployeeId,
      targetEmployeeId: target.id,
      oldDisplayName: target.displayName,
      newDisplayName: input.newDisplayName.trim(),
    },
    include: { target: { select: { employeeCode: true } } },
  });
  return summary(request);
}

export async function getProfileCorrection(requestId: string, requesterEmployeeId: string) {
  const request = await db.employeeProfileCorrectionRequest.findUnique({
    where: { id: requestId },
    include: { target: { select: { employeeCode: true } } },
  });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("profile_correction_not_found");
  return summary(request);
}

export async function confirmProfileCorrection(requestId: string, requesterEmployeeId: string) {
  await assertRequester(requesterEmployeeId);
  const request = await db.employeeProfileCorrectionRequest.findUnique({
    where: { id: requestId },
    include: { target: { select: { employeeCode: true } } },
  });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("profile_correction_not_found");
  if (request.status !== "AWAITING_CONFIRMATION")
    throw new Error("profile_correction_not_confirmable");
  const confirmed = await db.employeeProfileCorrectionRequest.update({
    where: { id: requestId },
    data: { status: "CONFIRMED", confirmedAt: new Date() },
    include: { target: { select: { employeeCode: true } } },
  });
  return summary(confirmed);
}

export async function cancelProfileCorrection(requestId: string, requesterEmployeeId: string) {
  await assertRequester(requesterEmployeeId);
  const request = await db.employeeProfileCorrectionRequest.findUnique({
    where: { id: requestId },
    include: { target: { select: { employeeCode: true } } },
  });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("profile_correction_not_found");
  if (request.status === "EXECUTED") throw new Error("profile_correction_already_executed");
  const cancelled = await db.employeeProfileCorrectionRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    include: { target: { select: { employeeCode: true } } },
  });
  return summary(cancelled);
}

export async function executeProfileCorrection(requestId: string, requesterEmployeeId: string) {
  await assertRequester(requesterEmployeeId);
  const request = await db.employeeProfileCorrectionRequest.findUnique({
    where: { id: requestId },
  });
  if (!request || request.requesterEmployeeId !== requesterEmployeeId)
    throw new Error("profile_correction_not_found");
  if (request.status !== "CONFIRMED") throw new Error("profile_correction_confirmation_required");

  const target = await db.$transaction(async (tx) => {
    const current = await tx.employee.findUnique({ where: { id: request.targetEmployeeId } });
    if (!current) throw new Error("target_employee_not_found");
    if (current.displayName !== request.oldDisplayName) throw new Error("profile_correction_stale");
    const updated = await tx.employee.update({
      where: { id: current.id },
      data: { displayName: request.newDisplayName },
    });
    await tx.employeeProfileCorrectionRequest.update({
      where: { id: request.id },
      data: { status: "EXECUTED", executedAt: new Date() },
    });
    return updated;
  });

  await audit({
    type: "EMPLOYEE_PROFILE_CORRECTED",
    employeeId: requesterEmployeeId,
    resourceType: "Employee",
    resourceId: target.id,
    metadata: {
      employeeCode: target.employeeCode,
      oldDisplayName: request.oldDisplayName,
      newDisplayName: request.newDisplayName,
      correctionRequestId: request.id,
    },
  });
  return {
    requestId,
    status: "EXECUTED",
    employeeCode: target.employeeCode,
    displayName: target.displayName,
  };
}
