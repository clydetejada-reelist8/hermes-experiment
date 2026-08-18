import Fastify, { type FastifyInstance } from "fastify";

export interface ServerOptions {
  internalServiceToken: string;
  logger?: boolean;
}

/**
 * Build the Hermes API Fastify instance. Exposed for testing via `app.inject`.
 *
 * Routes:
 *   GET /health        — unauthenticated liveness probe.
 *   GET /v1/health     — unauthenticated liveness probe (versioned).
 *   GET /v1/echo       — internal-auth-protected smoke route.
 *
 * All /v1/* routes require `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`.
 */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  // Internal auth guard for all /v1/* routes except /v1/health.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/v1/")) return;
    if (url === "/v1/health") return;
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: "missing_authorization" });
    }
    const token = auth.slice("Bearer ".length);
    if (token !== opts.internalServiceToken) {
      return reply.code(401).send({ error: "invalid_authorization" });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/v1/health", async () => ({ status: "ok" }));
  app.get("/v1/echo", async () => ({ status: "ok", echo: true }));

  return app;
}

async function start(): Promise<void> {
  const { loadConfig } = await import("@hermes/config");
  const cfg = loadConfig(process.env);
  const app = await buildServer({
    internalServiceToken: cfg.internalServiceToken,
    logger: true,
  });
  await app.listen({ port: cfg.apiPort, host: "0.0.0.0" });
}

// Start when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
