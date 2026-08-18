import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { resolveDiscordEmployee, requireActiveStagingEmployee } from "./index.js";
import { IdentityDeniedError } from "./types.js";
import { db } from "@hermes/db";

async function seedEmployee(opts: {
  status?: "ACTIVE" | "SUSPENDED" | "TERMINATED";
  allowlisted?: boolean;
  discordId?: string;
}) {
  const id = randomUUID();
  const suffix = id.slice(0, 8);
  const emp = await db.employee.create({
    data: {
      id,
      employeeCode: `EMP-${suffix}`,
      displayName: `Test ${suffix}`,
      companyEmail: `test-${suffix}@reelist8.example`,
      timezone: "Asia/Manila",
      employmentStatus: opts.status ?? "ACTIVE",
      stagingAllowlisted: opts.allowlisted ?? true,
    },
  });
  const discordId = opts.discordId ?? randomUUID();
  await db.externalIdentity.create({
    data: { employeeId: id, provider: "DISCORD", providerSubjectId: discordId },
  });
  return { emp, discordId };
}

describe("resolveDiscordEmployee", () => {
  it("resolves an active allowlisted employee by Discord identity", async () => {
    const { emp, discordId } = await seedEmployee({});
    const resolved = await resolveDiscordEmployee(discordId);
    expect(resolved.id).toBe(emp.id);
    expect(resolved.timezone).toBe("Asia/Manila");
  });

  it("rejects an unknown Discord user", async () => {
    await expect(resolveDiscordEmployee(randomUUID())).rejects.toBeInstanceOf(IdentityDeniedError);
    await expect(resolveDiscordEmployee(randomUUID())).rejects.toMatchObject({
      reason: "IDENTITY_NOT_FOUND",
    });
  });

  it("rejects a suspended employee", async () => {
    const { discordId } = await seedEmployee({ status: "SUSPENDED" });
    await expect(resolveDiscordEmployee(discordId)).rejects.toMatchObject({
      reason: "EMPLOYEE_INACTIVE",
    });
  });

  it("rejects a non-allowlisted employee", async () => {
    const { discordId } = await seedEmployee({ allowlisted: false });
    await expect(resolveDiscordEmployee(discordId)).rejects.toMatchObject({
      reason: "NOT_ALLOWLISTED",
    });
  });
});

describe("requireActiveStagingEmployee", () => {
  it("returns an active allowlisted employee by id", async () => {
    const { emp } = await seedEmployee({});
    const got = await requireActiveStagingEmployee(emp.id);
    expect(got.id).toBe(emp.id);
  });

  it("rejects a non-allowlisted employee by id", async () => {
    const { emp } = await seedEmployee({ allowlisted: false });
    await expect(requireActiveStagingEmployee(emp.id)).rejects.toMatchObject({
      reason: "NOT_ALLOWLISTED",
    });
  });
});
