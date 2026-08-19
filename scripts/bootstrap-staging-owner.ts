#!/usr/bin/env tsx
/**
 * One-time guarded staging owner bootstrap.
 *
 * Required:
 *   HERMES_ALLOW_STAGING_OWNER_BOOTSTRAP=1
 *   DATABASE_URL=postgresql://.../hermes_staging
 *
 * Usage:
 *   pnpm tsx scripts/bootstrap-staging-owner.ts \
 *     --employee-code RL8-EMP-0001 \
 *     --discord-user-id <immutable Discord User ID> \
 *     --authority-domain company
 */
import { parseArgs } from "node:util";
import { bootstrapStagingOwner } from "@hermes/admin";

const { values } = parseArgs({
  options: {
    "employee-code": { type: "string" },
    "discord-user-id": { type: "string" },
    "authority-domain": { type: "string", default: "company" },
  },
});

if (!values["employee-code"] || !values["discord-user-id"]) {
  throw new Error("employee-code and discord-user-id are required");
}

const result = await bootstrapStagingOwner({
  employeeCode: values["employee-code"],
  discordUserId: values["discord-user-id"],
  authorityDomain: values["authority-domain"] ?? "company",
});

console.log(JSON.stringify(result));
