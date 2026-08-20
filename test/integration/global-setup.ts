import { resetDatabase } from "./reset-db.js";

function assertIsolatedIntegrationDatabase(databaseUrl: string): void {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (["hermes_staging", "hermes_production"].includes(databaseName)) {
    throw new Error(`integration_database_forbidden:${databaseName}`);
  }
  if (!["hermes_devtest", "hermes_test"].includes(databaseName)) {
    throw new Error(`integration_database_not_allowlisted:${databaseName}`);
  }
}

/**
 * Vitest global setup for the integration project. Integration tests are only
 * allowed to use an explicitly isolated DevTest/Test database.
 */
export async function setup(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  assertIsolatedIntegrationDatabase(process.env.DATABASE_URL);
  if (process.env.HERMES_ALLOW_DATABASE_RESET !== "1") return;
  await resetDatabase();
}
