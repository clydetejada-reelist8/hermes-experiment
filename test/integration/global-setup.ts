import { resetDatabase } from "./reset-db.js";

/**
 * Vitest global setup for the integration project: reset the staging test
 * database once before the suite so tests are deterministic across reruns.
 * Individual tests still use random IDs for isolation within a run.
 */
export async function setup(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await resetDatabase();
}
