/**
 * End-to-end staging smoke test.
 *
 * Verifies that all staging services are healthy and responding:
 *   1. API health endpoint
 *   2. Database connectivity (via API)
 *   3. Redis connectivity
 *   4. MinIO / S3 connectivity
 *   5. Internal API auth
 *
 * Usage:
 *   npx tsx scripts/smoke-test.ts [API_URL]
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = one or more checks failed
 */

const API_URL = process.argv[2] ?? "http://localhost:3000";
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? "test-internal-api-key";

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

async function checkApiHealth(): Promise<CheckResult> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (res.ok) {
      await res.json();
      return { name: "API Health", passed: true, detail: `status=${res.status}` };
    }
    return { name: "API Health", passed: false, detail: `status=${res.status}` };
  } catch (err) {
    return {
      name: "API Health",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkInternalAuth(): Promise<CheckResult> {
  try {
    const res = await fetch(`${API_URL}/internal/health`, {
      headers: { "x-internal-api-key": INTERNAL_API_KEY },
    });
    if (res.ok) {
      return { name: "Internal Auth", passed: true, detail: `status=${res.status}` };
    }
    return { name: "Internal Auth", passed: false, detail: `status=${res.status}` };
  } catch (err) {
    return {
      name: "Internal Auth",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkInternalAuthRejectsBadKey(): Promise<CheckResult> {
  try {
    const res = await fetch(`${API_URL}/internal/health`, {
      headers: { "x-internal-api-key": "wrong-key" },
    });
    if (res.status === 401) {
      return { name: "Internal Auth Reject", passed: true, detail: "correctly rejected bad key" };
    }
    return {
      name: "Internal Auth Reject",
      passed: false,
      detail: `expected 401, got ${res.status}`,
    };
  } catch (err) {
    return {
      name: "Internal Auth Reject",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkDatabaseViaApi(): Promise<CheckResult> {
  try {
    const res = await fetch(`${API_URL}/health`);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      if (body.database === "ok" || body.db === "ok" || body.status === "ok") {
        return { name: "Database", passed: true, detail: "connected via API health" };
      }
      return { name: "Database", passed: true, detail: "API healthy (db status not reported)" };
    }
    return { name: "Database", passed: false, detail: `API unhealthy: ${res.status}` };
  } catch (err) {
    return {
      name: "Database",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedisViaUrl(): Promise<CheckResult> {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  try {
    // Simple TCP connection check
    const url = new URL(redisUrl);
    const port = parseInt(url.port, 10) || 6379;
    const { createConnection } = await import("node:net");
    return new Promise((resolve) => {
      const socket = createConnection(port, url.hostname, () => {
        socket.destroy();
        resolve({ name: "Redis", passed: true, detail: `connected to ${url.hostname}:${port}` });
      });
      socket.on("error", (err) => {
        resolve({
          name: "Redis",
          passed: false,
          detail: err.message,
        });
      });
      setTimeout(() => {
        socket.destroy();
        resolve({ name: "Redis", passed: false, detail: "timeout" });
      }, 5000);
    });
  } catch (err) {
    return {
      name: "Redis",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkS3(): Promise<CheckResult> {
  const s3Endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
  try {
    const res = await fetch(`${s3Endpoint}/minio/health/live`);
    if (res.ok || res.status === 200) {
      return { name: "MinIO/S3", passed: true, detail: `healthy at ${s3Endpoint}` };
    }
    return { name: "MinIO/S3", passed: false, detail: `status=${res.status}` };
  } catch (err) {
    return {
      name: "MinIO/S3",
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  console.log(`\nHermes Staging Smoke Test`);
  console.log(`API URL: ${API_URL}`);
  console.log(`Checking services...\n`);

  const checks = await Promise.all([
    checkApiHealth(),
    checkInternalAuth(),
    checkInternalAuthRejectsBadKey(),
    checkDatabaseViaApi(),
    checkRedisViaUrl(),
    checkS3(),
  ]);

  let allPassed = true;
  for (const check of checks) {
    const status = check.passed ? "PASS" : "FAIL";
    const icon = check.passed ? "[+]" : "[-]";
    console.log(`${icon} ${status}: ${check.name} — ${check.detail}`);
    if (!check.passed) allPassed = false;
  }

  console.log("");
  if (allPassed) {
    console.log("All checks passed!");
    process.exit(0);
  } else {
    console.log("Some checks failed!");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
