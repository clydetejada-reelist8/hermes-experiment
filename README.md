# Hermes — REELIST8 Control Plane

Hermes is REELIST8's internal AI operating layer. This repository implements the
**staging** Control Plane described in the reviewed system design. The existing
Hermes Agent gateway remains the employee-facing Discord and model runtime.

- System design: [`docs/superpowers/specs/2026-08-18-hermes-staging-design.md`](docs/superpowers/specs/2026-08-18-hermes-staging-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-08-18-hermes-staging.md`](docs/superpowers/plans/2026-08-18-hermes-staging.md)

## Architecture

A TypeScript `pnpm` monorepo deployed as a modular monolith behind Hermes:

- `apps/api` — Fastify HTTP API, OAuth callbacks, admin/staging endpoints.
- `apps/discord` — experimental standalone Discord edge; **development/test-only**.
  It is not the production responder and must not run when the existing Hermes
  gateway is active.
- `apps/worker` — BullMQ background ingestion, embeddings, sync, revocation jobs.

Shared `packages/*` provide contracts, database access, policy, memory,
knowledge, actions, LLM integration, audit, and observability.

## Stack

TypeScript, Node.js >= 22, pnpm workspaces, Fastify, Prisma, PostgreSQL >= 16

- pgvector, Zod, Pino, and Vitest. The initial Control Plane search path uses
  PostgreSQL full-text search and does not require an OpenAI API key or paid
  embedding service. Hermes owns model inference.

## Hermes integration boundary

The first backend slice exposes internal, bearer-authenticated routes:

```text
POST /v1/identity/resolve
POST /v1/search
```

`/v1/identity/resolve` maps a Discord User ID to a canonical REELIST8 employee.
`/v1/search` resolves the Discord identity first, then filters evidence by
employee/team/project/company scope before returning citation metadata. It never
calls an LLM.

The intended production flow is:

```text
Discord → existing Hermes gateway → Control Plane search → Hermes model → Discord
```

Do not configure a second Discord bot for this repository. The standalone
`apps/discord` process is retained only as an experimental future edge.

### Canonical production answer path

The only supported production answer path is:

```text
Employee surface → Hermes Agent gateway/model → REELIST8 MCP → Control Plane
                 → structured authorized evidence → Hermes response
```

`apps/discord/src/ask.ts` and its `AskOrchestrator` are development/test-only
legacy code. They are not wired into the production API startup or the active
Hermes MCP path. They remain available because their retrieval, egress, and
citation helpers are useful for isolated tests, but they must not be deployed as
a second answer responder.

## Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:integration
pnpm test:security
```

See the implementation plan for the staging deployment sequence and the
definition of done. PostgreSQL is required to run database-backed tests and the
API.

## Local staging verification

The full integration suite requires Docker access and the three local services:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
cp .env.example .env
# Replace INTERNAL_SERVICE_TOKEN and TOKEN_ENCRYPTION_KEY with local values.
docker compose up -d postgres redis minio
set -a; . ./.env; set +a
npx prisma@6.2.1 migrate reset --force --skip-seed --schema packages/db/prisma/schema.prisma
HERMES_ALLOW_DATABASE_RESET=1 ./node_modules/.bin/vitest run
```

The database reset command is intentionally destructive and must only be used
against the isolated `hermes_staging` database. Never point it at production.

If Docker access was granted during the current login session, use `newgrp
docker` or start a new shell before running Compose. Do not make the Docker
socket world-writable.
