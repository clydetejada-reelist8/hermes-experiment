# Multi-stage Dockerfile for Hermes apps (API, Discord, Worker)
# Builds all packages and then runs the specified app.
#
# Build args:
#   APP=api|discord|worker (default: api)
#
# Usage:
#   docker build --build-arg APP=api -t hermes-api .
#   docker build --build-arg APP=discord -t hermes-discord .
#   docker build --build-arg APP=worker -t hermes-worker .

ARG NODE_VERSION=22
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG SCHEMA_VERSION=20260819120000_document_extraction_support

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: Build
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
RUN corepack enable
ARG GIT_COMMIT
ARG BUILD_TIME
ARG SCHEMA_VERSION
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
ENV SCHEMA_VERSION=${SCHEMA_VERSION}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @hermes/db exec prisma generate --schema prisma/schema.prisma
RUN pnpm typecheck
RUN pnpm build

# ---------------------------------------------------------------------------
# Stage 3: Production image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app

ARG APP=api
ARG GIT_COMMIT=unknown
ARG BUILD_TIME=unknown
ARG SCHEMA_VERSION=20260819120000_document_extraction_support
ENV NODE_ENV=production
ENV APP_NAME=${APP}
ENV GIT_COMMIT=${GIT_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}
ENV SCHEMA_VERSION=${SCHEMA_VERSION}

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/node_modules ./node_modules

# Prisma client is needed at runtime
COPY --from=builder /app/packages/db/src/generated ./packages/db/src/generated

EXPOSE 3000

# The entrypoint runs the specified app
CMD ["sh", "-c", "case \"$APP_NAME\" in api) exec node apps/api/dist/server.js ;; worker) exec node apps/worker/dist/main.js ;; *) exec node apps/$APP_NAME/dist/index.js ;; esac"]
