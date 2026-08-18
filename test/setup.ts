// Vitest global setup: load a local .env (gitignored) if present so that
// infrastructure-backed integration tests can resolve DATABASE_URL/REDIS_URL
// without requiring external env injection. In CI, real env vars take
// precedence because process.loadEnvFile does not override existing keys.
try {
  process.loadEnvFile();
} catch {
  // No .env present — rely on already-injected environment (CI).
}
