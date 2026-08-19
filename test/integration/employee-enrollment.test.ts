import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../packages/db/src/index.js";
import { resolveDiscordEmployee } from "../../packages/identity/src/index.js";
import {
  cancelEmployeeEnrollment,
  confirmEmployeeEnrollment,
  executeEmployeeEnrollment,
  getEmployeeEnrollment,
  prepareEmployeeEnrollment,
  prepareEmployeeIdentityLink,
} from "../../packages/admin/src/enrollment.js";

describe.skipIf(!process.env.DATABASE_URL)("staging employee enrollment integration", () => {
  let ownerId = "";
  const createdEmployeeIds: string[] = [];
  const enrollmentIds: string[] = [];

  beforeAll(async () => {
    ownerId = (await db.employee.findUniqueOrThrow({ where: { employeeCode: "RL8-EMP-0001" } })).id;
  });

  afterAll(async () => {
    if (enrollmentIds.length)
      await db.employeeEnrollmentRequest.deleteMany({ where: { id: { in: enrollmentIds } } });
    for (const employeeId of createdEmployeeIds) {
      await db.auditEvent.deleteMany({ where: { resourceId: employeeId } });
      await db.employee.delete({ where: { id: employeeId } });
    }
    await db.$disconnect();
  });

  function validInput(overrides: Partial<Parameters<typeof prepareEmployeeEnrollment>[0]> = {}) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    return {
      requesterEmployeeId: ownerId,
      fullName: "Enrolled QA Employee",
      companyEmail: `enrolled-${suffix}@reelist8.example`,
      timezone: "Asia/Manila",
      discordUserId: `9${Array.from(randomUUID())
        .map((char) => String(char.charCodeAt(0) % 10))
        .join("")
        .slice(0, 17)}`,
      employeeCode: `RL8-EMP-${Math.floor(Math.random() * 8999 + 1000)}`,
      initialRoleKeys: ["staging-company-reader"],
      stagingAllowlisted: true,
      ...overrides,
    };
  }

  it("prepares without writes, confirms, executes transactionally, audits, and resolves identity", async () => {
    const input = validInput();
    const before = await db.employee.count();
    const prepared = await prepareEmployeeEnrollment(input);
    enrollmentIds.push(prepared.id);
    expect(prepared.status).toBe("AWAITING_CONFIRMATION");
    expect(await db.employee.count()).toBe(before);

    expect((await getEmployeeEnrollment(prepared.id, ownerId)).status).toBe(
      "AWAITING_CONFIRMATION",
    );
    await confirmEmployeeEnrollment(prepared.id, ownerId);
    const executed = await executeEmployeeEnrollment(prepared.id, ownerId);
    createdEmployeeIds.push(executed.employeeId);
    expect(executed.employeeCode).toBe(input.employeeCode);

    const resolved = await resolveDiscordEmployee(input.discordUserId);
    expect(resolved.employeeCode).toBe(input.employeeCode);
    const audit = await db.auditEvent.findFirst({
      where: { type: "EMPLOYEE_ENROLLED", resourceId: executed.employeeId },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects duplicates, invalid roles/timezones, and unapproved code formats", async () => {
    const existing = validInput({
      discordUserId: "694717338074742844",
      employeeCode: "RL8-EMP-0999",
      companyEmail: "clyde.tejada@reelist8.com",
    });
    await expect(prepareEmployeeEnrollment(existing)).rejects.toThrow(
      "discord_identity_already_linked",
    );
    await expect(
      prepareEmployeeEnrollment(validInput({ employeeCode: "RL8-EMP-0001" })),
    ).rejects.toThrow("existing_employee_link_required");
    await expect(
      prepareEmployeeEnrollment(validInput({ companyEmail: "clyde.tejada@reelist8.com" })),
    ).rejects.toThrow("existing_employee_link_required");
    await expect(
      prepareEmployeeEnrollment(validInput({ initialRoleKeys: ["not-a-role"] })),
    ).rejects.toThrow("invalid_initial_role");
    await expect(
      prepareEmployeeEnrollment(validInput({ timezone: "Mars/Olympus" })),
    ).rejects.toThrow("invalid_timezone");
    await expect(
      prepareEmployeeEnrollment(validInput({ employeeCode: "EMP-1234" })),
    ).rejects.toThrow("approved_employee_code_required");
  });

  it("links a new Discord identity to an existing employee without duplicating it", async () => {
    const targetDiscordId = `7${Array.from(randomUUID())
      .map((char) => String(char.charCodeAt(0) % 10))
      .join("")
      .slice(0, 17)}`;
    const prepared = await prepareEmployeeIdentityLink({
      requesterEmployeeId: ownerId,
      employeeCode: "RL8-EMP-0001",
      discordUserId: targetDiscordId,
    });
    enrollmentIds.push(prepared.id);
    await confirmEmployeeEnrollment(prepared.id, ownerId);
    const result = await executeEmployeeEnrollment(prepared.id, ownerId);
    expect(result.employeeCode).toBe("RL8-EMP-0001");
    expect(await db.employee.count({ where: { employeeCode: "RL8-EMP-0001" } })).toBe(1);
    expect((await resolveDiscordEmployee(targetDiscordId)).employeeCode).toBe("RL8-EMP-0001");
    await db.auditEvent.deleteMany({
      where: { type: "EMPLOYEE_IDENTITY_LINKED", resourceId: ownerId },
    });
    await db.externalIdentity.deleteMany({
      where: { provider: "DISCORD", providerSubjectId: targetDiscordId },
    });
  });
  it("requires confirmation and rolls back when a duplicate appears after confirmation", async () => {
    const input = validInput();
    const prepared = await prepareEmployeeEnrollment(input);
    enrollmentIds.push(prepared.id);
    await confirmEmployeeEnrollment(prepared.id, ownerId);
    const race = await db.employee.create({
      data: {
        employeeCode: input.employeeCode,
        displayName: "Race Target",
        companyEmail: `race-${randomUUID()}@reelist8.example`,
        timezone: input.timezone,
        employmentStatus: "ACTIVE",
      },
    });
    try {
      await expect(executeEmployeeEnrollment(prepared.id, ownerId)).rejects.toThrow(
        "existing_employee_link_required",
      );
      expect(
        await db.externalIdentity.findUnique({
          where: {
            provider_providerSubjectId: {
              provider: "DISCORD",
              providerSubjectId: input.discordUserId,
            },
          },
        }),
      ).toBeNull();
    } finally {
      await db.employee.delete({ where: { id: race.id } });
    }
  });

  it("supports cancellation and rejects an unauthorized requester", async () => {
    const requester = await db.employee.create({
      data: {
        employeeCode: `RL8-EMP-${Math.floor(Math.random() * 8999 + 1000)}`,
        displayName: "Unauthorized QA Requester",
        companyEmail: `unauthorized-${randomUUID()}@reelist8.example`,
        timezone: "Asia/Manila",
        employmentStatus: "ACTIVE",
        stagingAllowlisted: true,
      },
    });
    createdEmployeeIds.push(requester.id);
    await expect(
      prepareEmployeeEnrollment(validInput({ requesterEmployeeId: requester.id })),
    ).rejects.toThrow("employee_enroll_capability_required");

    const prepared = await prepareEmployeeEnrollment(validInput());
    enrollmentIds.push(prepared.id);
    expect((await cancelEmployeeEnrollment(prepared.id, ownerId)).status).toBe("CANCELLED");
  });
});
