import { resetDatabase } from "./reset-db.js";

/**
 * Vitest global setup for the integration project: reset the staging test
 * database once before the suite so tests are deterministic across reruns.
 * Individual tests still use random IDs for isolation within a run.
 */
export async function setup(): Promise<void> {
  // Never reset a real staging/production database just because DATABASE_URL is
  // present in the shell. CI and explicitly isolated test environments must
  // opt in to destructive fixture setup.
  if (process.env.HERMES_ALLOW_DATABASE_RESET !== "1") return;
  if (!process.env.DATABASE_URL) return;
  await resetDatabase();
}
