# Staging deployment and version verification

Hermes remains the employee-facing orchestrator. The Control Plane API and worker are separate services.

## Current systemd deployment

Inspect before changing anything:

```bash
systemctl cat reelist8-control-plane.service
systemctl status reelist8-control-plane.service --no-pager
systemctl cat hermes-gateway.service
```

The API service runs the compiled entrypoint:

```text
/home/hermes/reelist8-hermes-experiment/apps/api/dist/server.js
```

Its environment file is:

```text
/home/hermes/.hermes/reelist8-control-plane.env
```

Do not print that file; it contains secrets.

## Build a specific repository commit

From the repository:

```bash
git fetch origin
git rev-parse HEAD
npx pnpm@10.12.1 install --frozen-lockfile
npx prisma@6.2.1 migrate deploy --schema packages/db/prisma/schema.prisma
npx pnpm@10.12.1 typecheck
npx pnpm@10.12.1 build
```

Record the commit SHA before restarting. The build script removes stale generated Prisma output before copying the current client.

Set these non-secret values in the service environment when deploying a build:

```text
GIT_COMMIT=<git rev-parse HEAD>
BUILD_TIME=<UTC build time>
SCHEMA_VERSION=20260819040000_add_reminders_write_capability
WORKER_HEARTBEAT_FILE=/run/reelist8/worker.heartbeat
```

Secrets remain in the existing service environment file and must not be committed.

## Start the worker

The worker entrypoint is:

```text
apps/worker/dist/main.js
```

It consumes the existing Redis queue:

```text
hermes.jobs
```

It writes the heartbeat file configured by `WORKER_HEARTBEAT_FILE`.

Run it under a separate systemd unit or Compose worker service. Do not run a second Discord responder.

## Restart only after build and migration verification

```bash
systemctl restart reelist8-control-plane.service
systemctl restart reelist8-worker.service
```

If the worker unit does not yet exist, create it from the repository deployment configuration first; do not assume the service name.

Hermes Gateway normally does not need a restart for Control Plane code changes unless the MCP process or Hermes configuration changed.

## Verify the live build

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/version
curl -fsS http://127.0.0.1:3000/health/ready
```

Expected `/version` shape:

```json
{
  "gitCommit": "<deployed commit>",
  "buildTime": "<build time>",
  "schemaVersion": "20260819040000_add_reminders_write_capability"
}
```

The `gitCommit` value must equal the commit that was built. A healthy `/health` response alone is not sufficient.

Expected route checks:

```text
GET  /health
GET  /version
GET  /health/ready
GET  /v1/health
POST /v1/identity/resolve
POST /v1/search
POST /v1/uploads
POST /v1/actions/prepare
```

Verify Hermes MCP separately:

```bash
hermes mcp list
systemctl status hermes-gateway.service --no-pager
```

Then perform one read-only MCP search using an approved identity and confirm the Control Plane logs show `/v1/identity/resolve` followed by `/v1/search`.
