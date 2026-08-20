import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../packages/db/src/index.js";
import { resolveDiscordEmployee } from "../../packages/identity/src/index.js";
import {
  executeAdminChange,
  prepareAdminChange,
  confirmAdminChange,
} from "../../packages/admin/src/management.js";

describe.skipIf(!process.env.DATABASE_URL)("staging admin management integration", () => {
  let requesterEmployeeId = "";
  let targetEmployeeId = "";
  let targetEmployeeCode = "";

  beforeAll(async () => {
    const requester = await db.employee.findUniqueOrThrow({
      where: { employeeCode: "RL8-EMP-0001" },
    });
    requesterEmployeeId = requester.id;
    targetEmployeeCode = `TEST-ADMIN-${randomUUID().slice(0, 8)}`;
    const target = await db.employee.create({
      data: {
        employeeCode: targetEmployeeCode,
        displayName: "Temporary Admin Test Target",
        companyEmail: `${targetEmployeeCode.toLowerCase()}@reelist8.example`,
        timezone: "Asia/Manila",
        employmentStatus: "ACTIVE",
        stagingAllowlisted: true,
      },
    });
    targetEmployeeId = target.id;
  });

  afterAll(async () => {
    await db.adminChangeRequest.deleteMany({ where: { targetEmployeeId } });
    await db.auditEvent.deleteMany({ where: { resourceId: targetEmployeeId } });
    await db.employeeRole.deleteMany({ where: { employeeId: targetEmployeeId } });
    await db.domainAuthority.deleteMany({ where: { employeeId: targetEmployeeId } });
    if (targetEmployeeId) await db.employee.delete({ where: { id: targetEmployeeId } });
    await db.$disconnect();
  });

  it("requires confirmation, audits grants/removals, and revokes immediately", async () => {
    const prepared = await prepareAdminChange({
      requesterEmployeeId,
      targetEmployeeCode,
      operation: "GRANT_ROLE",
      roleKey: "staging-company-reader",
    });
    await expect(executeAdminChange(prepared.id, requesterEmployeeId)).rejects.toThrow(
      "admin_change_confirmation_required",
    );
    await confirmAdminChange(prepared.id, requesterEmployeeId);
    await executeAdminChange(prepared.id, requesterEmployeeId);
    await expect(
      db.employeeRole.findFirstOrThrow({
        where: {
          employeeId: targetEmployeeId,
          role: { key: "staging-company-reader" },
          activeUntil: null,
        },
      }),
    ).resolves.toBeTruthy();

    const revoke = await prepareAdminChange({
      requesterEmployeeId,
      targetEmployeeCode,
      operation: "REVOKE_ROLE",
      roleKey: "staging-company-reader",
    });
    await confirmAdminChange(revoke.id, requesterEmployeeId);
    await executeAdminChange(revoke.id, requesterEmployeeId);
    expect(
      await db.employeeRole.findFirst({
        where: {
          employeeId: targetEmployeeId,
          role: { key: "staging-company-reader" },
          activeUntil: null,
        },
      }),
    ).toBeNull();

    const auditTypes = await db.auditEvent.findMany({
      where: { resourceId: targetEmployeeId },
      select: { type: true },
    });
    expect(auditTypes.map((row) => row.type)).toEqual(
      expect.arrayContaining(["ADMIN_ROLE_GRANTED", "ADMIN_ROLE_REVOKED"]),
    );
  });

  it("rejects an unmapped Discord identity before admin operations", async () => {
    await expect(resolveDiscordEmployee("000000000000000000")).rejects.toMatchObject({
      reason: "IDENTITY_NOT_FOUND",
    });
  });
});
