# Hermes — REELIST8 Staging

Hermes is REELIST8's internal AI operating layer. This repository implements the
**staging** vertical slice described in the reviewed system design and executed
through the reviewed implementation plan.

- System design: [`docs/superpowers/specs/2026-08-18-hermes-staging-design.md`](docs/superpowers/specs/2026-08-18-hermes-staging-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-08-18-hermes-staging.md`](docs/superpowers/plans/2026-08-18-hermes-staging.md)

## Architecture

A TypeScript `pnpm` monorepo deployed as a modular monolith:

- `apps/api` — Fastify HTTP API, OAuth callbacks, admin/staging endpoints.
- `apps/discord` — Discord Gateway / interactions edge.
- `apps/worker` — BullMQ background ingestion, embeddings, sync, revocation jobs.

Shared `packages/*` provide contracts, database access, policy, memory,
knowledge, actions, LLM integration, audit, and observability.

## Stack

TypeScript, Node.js >= 22, pnpm workspaces, Fastify, discord.js, Prisma,
PostgreSQL >= 16 + pgvector, Redis >= 7, BullMQ, S3-compatible object storage,
Google `googleapis`, OpenAI official SDK (Responses API + embeddings), Zod,
Pino, Vitest.

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
definition of done.
