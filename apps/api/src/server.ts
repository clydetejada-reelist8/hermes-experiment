import Fastify, { type FastifyInstance } from "fastify";
import { resolveDiscordEmployee, type Employee } from "@hermes/identity";
import { IdentityDeniedError } from "@hermes/identity";
import { searchVisibleKnowledge, type SearchEvidence, type SearchInput } from "./search.js";

export interface ResolvedIdentity {
  id: string;
  employeeCode: string;
  displayName: string;
  discordUserId: string;
}

export interface ServerOptions {
  internalServiceToken: string;
  logger?: boolean;
  resolveDiscordIdentity?: (discordUserId: string) => Promise<ResolvedIdentity>;
  searchKnowledge?: (input: SearchInput) => Promise<SearchEvidence[]>;
}

function defaultResolveDiscordIdentity(discordUserId: string): Promise<ResolvedIdentity> {
  return resolveDiscordEmployee(discordUserId).then((employee: Employee) => ({
    id: employee.id,
    employeeCode: employee.employeeCode,
    displayName: employee.displayName,
    discordUserId,
  }));
}

/**
 * Build the Hermes Control Plane API.
 *
 * The API is intentionally model-free: Hermes remains responsible for model
 * reasoning while this service resolves identity and returns permission-
 * filtered evidence.
 */
export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const resolveIdentity = opts.resolveDiscordIdentity ?? defaultResolveDiscordIdentity;
  const searchKnowledge = opts.searchKnowledge ?? searchVisibleKnowledge;

  // Internal auth guard for all /v1/* routes except /v1/health.
  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0] ?? request.url;
    if (!url.startsWith("/v1/") || url === "/v1/health") return;

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

  app.post<{ Body: { provider?: string; subjectId?: string } }>(
    "/v1/identity/resolve",
    async (request, reply) => {
      const provider = request.body?.provider;
      const subjectId = request.body?.subjectId?.trim();
      if (provider !== "DISCORD" || !subjectId) {
        return reply.code(400).send({ error: "invalid_identity_request" });
      }

      try {
        const identity = await resolveIdentity(subjectId);
        return {
          employeeId: identity.id,
          employeeCode: identity.employeeCode,
          displayName: identity.displayName,
          provider: "DISCORD",
          subjectId: identity.discordUserId,
        };
      } catch (error) {
        if (error instanceof IdentityDeniedError) {
          return reply.code(403).send({ error: "identity_denied", reason: error.reason });
        }
        request.log.error(error);
        return reply.code(500).send({ error: "identity_resolution_failed" });
      }
    },
  );

  app.post<{
    Body: { discordUserId?: string; query?: string; limit?: number };
  }>("/v1/search", async (request, reply) => {
    const discordUserId = request.body?.discordUserId?.trim();
    const query = request.body?.query?.trim();
    const limit = Number.isFinite(request.body?.limit) ? Number(request.body?.limit) : 10;

    if (!discordUserId || !query) {
      return reply.code(400).send({ error: "invalid_search_request" });
    }

    try {
      const identity = await resolveIdentity(discordUserId);
      const results = await searchKnowledge({
        employeeId: identity.id,
        query,
        limit,
      });
      return { employeeId: identity.id, results };
    } catch (error) {
      if (error instanceof IdentityDeniedError) {
        return reply.code(403).send({ error: "identity_denied", reason: error.reason });
      }
      request.log.error(error);
      return reply.code(500).send({ error: "search_failed" });
    }
  });

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
