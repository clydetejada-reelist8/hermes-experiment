import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../packages/db/src/index.js";
import { resolveDiscordEmployee } from "../../packages/identity/src/index.js";
import {
  cancelProfileCorrection,
  confirmProfileCorrection,
  executeProfileCorrection,
  getProfileCorrection,
  prepareProfileCorrection,
} from "../../packages/admin/src/profile-corrections.js";

describe.skipIf(!process.env.DATABASE_URL)("staging employee profile corrections", () => {
  let requesterId = "";
  const requestIds: string[] = [];
  let targetId = "";

  beforeAll(async () => {
    requesterId = (await db.employee.findUniqueOrThrow({ where: { employeeCode: "RL8-EMP-0001" } }))
      .id;
    targetId = (await db.employee.findUniqueOrThrow({ where: { employeeCode: "RL8-EMP-0002" } }))
      .id;
  });

  afterAll(async () => {
    if (requestIds.length) {
      await db.employeeProfileCorrectionRequest.deleteMany({ where: { id: { in: requestIds } } });
    }
    await db.auditEvent.deleteMany({
      where: { type: "EMPLOYEE_PROFILE_CORRECTED", resourceId: targetId },
    });
    await db.employee.update({ where: { id: targetId }, data: { displayName: "Borj de Borja" } });
    await db.$disconnect();
  });

  it("prepares, confirms, executes, audits, and preserves identity", async () => {
    const prepared = await prepareProfileCorrection({
      requesterEmployeeId: requesterId,
      targetEmployeeCode: "RL8-EMP-0002",
      newDisplayName: "Ryan de Borja",
    });
    requestIds.push(prepared.id);
    expect(prepared.oldDisplayName).toBe("Borj de Borja");
    expect(prepared.status).toBe("AWAITING_CONFIRMATION");
    expect((await getProfileCorrection(prepared.id, requesterId)).status).toBe(
      "AWAITING_CONFIRMATION",
    );
    await expect(executeProfileCorrection(prepared.id, requesterId)).rejects.toThrow(
      "profile_correction_confirmation_required",
    );
    await confirmProfileCorrection(prepared.id, requesterId);
    const result = await executeProfileCorrection(prepared.id, requesterId);
    expect(result.displayName).toBe("Ryan de Borja");
    expect((await resolveDiscordEmployee("988757778610933811")).employeeCode).toBe("RL8-EMP-0002");
    expect(
      await db.auditEvent.findFirst({
        where: { type: "EMPLOYEE_PROFILE_CORRECTED", resourceId: targetId },
      }),
    ).not.toBeNull();
  });

  it("can cancel without changing the employee", async () => {
    const prepared = await prepareProfileCorrection({
      requesterEmployeeId: requesterId,
      targetEmployeeCode: "RL8-EMP-0002",
      newDisplayName: "Borj Sir",
    });
    requestIds.push(prepared.id);
    expect((await cancelProfileCorrection(prepared.id, requesterId)).status).toBe("CANCELLED");
    expect((await db.employee.findUniqueOrThrow({ where: { id: targetId } })).displayName).toBe(
      "Ryan de Borja",
    );
  });
});
