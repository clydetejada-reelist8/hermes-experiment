#!/usr/bin/env tsx
/**
 * Seed staging employees from an explicit JSON file.
 *
 * Usage:
 *   pnpm tsx scripts/seed-staging.ts --employees ./staging-employees.json
 *
 * The JSON file is an array of employees:
 *   [{
 *     "employeeCode": "EMP-0001",
 *     "displayName": "Ada Lovelace",
 *     "companyEmail": "ada@reelist8.example",
 *     "timezone": "Asia/Manila",
 *     "discordUserId": "1234567890",
 *     "stagingAllowlisted": true
 *   }]
 *
 * Never hard-code real employee identities in the repository. The operator
 * supplies the JSON out-of-band. This script is idempotent: re-running with the
 * same file updates existing records rather than duplicating them.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { db } from "@hermes/db";

interface SeedEmployee {
  employeeCode: string;
  displayName: string;
  companyEmail: string;
  timezone: string;
  discordUserId: string;
  stagingAllowlisted?: boolean;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { employees: { type: "string" } },
  });
  if (!values.employees) {
    console.error("Usage: seed-staging.ts --employees <path-to-json>");
    process.exit(1);
  }
  const raw = await readFile(values.employees, "utf8");
  const employees: SeedEmployee[] = JSON.parse(raw);
  if (!Array.isArray(employees) || employees.length === 0) {
    console.error("employees file must be a non-empty array");
    process.exit(1);
  }

  let updated = 0;
  for (const e of employees) {
    const emp = await db.employee.upsert({
      where: { employeeCode: e.employeeCode },
      create: {
        employeeCode: e.employeeCode,
        displayName: e.displayName,
        companyEmail: e.companyEmail,
        timezone: e.timezone,
        stagingAllowlisted: e.stagingAllowlisted ?? true,
        employmentStatus: "ACTIVE",
      },
      update: {
        displayName: e.displayName,
        companyEmail: e.companyEmail,
        timezone: e.timezone,
        stagingAllowlisted: e.stagingAllowlisted ?? true,
        employmentStatus: "ACTIVE",
      },
    });
    await db.externalIdentity.upsert({
      where: {
        provider_providerSubjectId: {
          provider: "DISCORD",
          providerSubjectId: e.discordUserId,
        },
      },
      create: {
        employeeId: emp.id,
        provider: "DISCORD",
        providerSubjectId: e.discordUserId,
        verifiedAt: new Date(),
      },
      update: { employeeId: emp.id, verifiedAt: new Date() },
    });
    updated++;
  }
  console.log(`seeded ${employees.length} employees (${updated} upserts).`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
