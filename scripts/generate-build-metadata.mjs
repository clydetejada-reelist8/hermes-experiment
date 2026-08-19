/* global process, URL */

import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

try {
  process.loadEnvFile();
} catch {
  // CI and containers provide environment variables directly.
}

const root = resolve(new URL("..", import.meta.url).pathname);
const gitCommit = process.env.GIT_COMMIT ?? gitRevision(root);
const buildTime = process.env.BUILD_TIME ?? new Date().toISOString();
const schemaVersion = process.env.SCHEMA_VERSION ?? (await appliedMigration(root));

if (!gitCommit || gitCommit === "unknown") throw new Error("build_metadata_git_commit_missing");
if (!schemaVersion || schemaVersion === "unknown")
  throw new Error("build_metadata_schema_version_missing");

if (hasGit(root)) {
  const actualCommit = gitRevision(root);
  if (actualCommit !== gitCommit) {
    throw new Error(
      `build_metadata_commit_mismatch: expected ${actualCommit}, received ${gitCommit}`,
    );
  }
  if (
    !process.env.ALLOW_DIRTY_BUILD &&
    execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()
  ) {
    throw new Error("build_metadata_dirty_worktree");
  }
}

const metadata = JSON.stringify({ gitCommit, buildTime, schemaVersion }, null, 2) + "\n";
for (const app of ["apps/api", "apps/worker"]) {
  const dist = join(root, app, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "build-metadata.json"), metadata, { mode: 0o644 });
}

function hasGit(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function gitRevision(cwd) {
  if (!hasGit(cwd)) return undefined;
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
}

async function appliedMigration(cwd) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("build_metadata_schema_version_missing");
  const db = await import(join(cwd, "packages/db/dist/index.js"));
  try {
    const rows = await db.db.$queryRawUnsafe(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
    );
    return rows[0]?.migration_name;
  } finally {
    await db.db.$disconnect();
  }
}
