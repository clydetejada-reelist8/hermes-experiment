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

# ---------------------------------------------------------------------------
# Stage 1: Install dependencies
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/*/package.json packages/*/
COPY apps/*/package.json apps/*/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2: Build
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate
RUN pnpm typecheck
RUN pnpm build || true

# ---------------------------------------------------------------------------
# Stage 3: Production image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runner
WORKDIR /app

ARG APP=api
ENV NODE_ENV=production
ENV APP_NAME=${APP}

RUN corepack enable

COPY --from=builder /app/package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/node_modules ./node_modules

# Prisma client is needed at runtime
COPY --from=builder /app/packages/db/src/generated ./packages/db/src/generated

EXPOSE 3000

# The entrypoint runs the specified app
CMD ["sh", "-c", "node apps/${APP_NAME}/dist/index.js"]
