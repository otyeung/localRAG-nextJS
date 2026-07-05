# Task 10 Report

## Status
DONE_WITH_CONCERNS

## Summary
Implemented Task 10 local container assets:
- Added multi-stage non-root `Dockerfile` for production-style Next.js image builds.
- Added `docker-compose.yml` wiring `nextjs`, `postgres`, `n8n`, `qdrant`, and optional `redis` over internal service names.
- Added `.dockerignore` for leaner build context.
- Added n8n workflow import assets for `ingestion` and `retrieval`.
- Added `docker/n8n/README.md` documenting local wiring and env-backed OpenAI credential setup.
- Added TDD coverage in `tests/unit/docker-compose.test.ts`.

## TDD Notes
1. Added `tests/unit/docker-compose.test.ts` first.
2. Ran `pnpm vitest run tests/unit/docker-compose.test.ts` and observed RED failure because `docker-compose.yml` did not exist.
3. Implemented Docker assets.
4. Re-ran the test until GREEN.

## Verification
Fresh verification after commit:
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅ (6/6 passing)
- `docker compose config --quiet` ✅
- `node -e "for (const file of ['docker/n8n/workflows/ingestion.json','docker/n8n/workflows/retrieval.json']) JSON.parse(require('node:fs').readFileSync(file,'utf8')); console.log('workflow json ok')"` ✅
- `git diff --check` ✅ before commit

## Commit
- `1964079 feat: add dockerized n8n qdrant stack`

## Self-review
- Confirmed compose uses internal hostnames `postgres`, `n8n`, `qdrant`, and `redis`.
- Confirmed hot reload support via bind-mounted source and `pnpm dev` command for `nextjs`.
- Confirmed app healthcheck targets `app/api/health`.
- Confirmed workflow assets are server-side imports and not exposed in client code.
- Confirmed unrelated `.gitignore` and `docs/lms_use_case.md` were not touched.

## Concerns
1. `docker build --target runner -f Dockerfile .` could not be fully validated because Docker Desktop timed out fetching `node:22.18.0-alpine` metadata from Docker Hub in this environment.
2. The imported n8n workflows expect a local credential named `OpenAI Embeddings (env)` to be created in n8n using env-backed header auth, as documented in `docker/n8n/README.md`.

## Task 10 Review Fixes (2026-07-06)
- Activated both imported n8n workflow assets so fresh imports register production `/webhook/ingestion` and `/webhook/retrieval` endpoints on startup.
- Added `qdrant-init` compose bootstrap service plus `scripts/ensure-qdrant-collection.mjs` to create or verify `QDRANT_COLLECTION` with configured vector size and distance before `n8n` and `nextjs` start.
- Updated ingestion workflow point-building logic to read source chunk metadata from the pre-embedding node and persist `documentId`, `uploadId`, `fileName`, `mimeType`, `requestId`, `chunkIndex`, and `content` into Qdrant payloads.
- Updated retrieval workflow search-building and normalization logic to reference pre-embedding request metadata (`query`, `conversationId`, `documentIds`, `topK`, `requestId`) when constructing the Qdrant search body and response envelope.
- Extended `tests/unit/docker-compose.test.ts` to cover the bootstrap service, active workflow exports, and metadata-preservation invariants.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅ (10/10 passing)
- `node -e "for (const file of ['docker/n8n/workflows/ingestion.json','docker/n8n/workflows/retrieval.json']) { JSON.parse(require('node:fs').readFileSync(file, 'utf8')); } console.log('workflow json ok')"` ✅
- `docker compose config --quiet` ✅
- `node --check scripts/ensure-qdrant-collection.mjs` ✅

## Task 10 Internal Exposure/Auth/Model Fixes (2026-07-06)
- Removed default host port publishing for `n8n` and `qdrant`; both services now stay internal via Compose `expose` while `nextjs` remains reachable for local app usage.
- Added required `N8N_WEBHOOK_SECRET` and `OPENAI_EMBEDDING_MODEL` env/config support, keeping `OPENAI_MODEL` for chat/agent usage only.
- Updated the server-side n8n client to send `x-n8n-webhook-secret` only on `/webhook/*` requests so the secret never reaches browser code.
- Added pre-webhook validation nodes to both n8n workflows and switched embedding requests to `OPENAI_EMBEDDING_MODEL`.
- Extended targeted tests to cover internal-only compose wiring, webhook secret propagation/validation, and embedding model configuration.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts tests/unit/config-env.test.ts tests/unit/n8n-client.test.ts` ✅ (23/23 passing)
- `node -e "for (const file of ['docker/n8n/workflows/ingestion.json','docker/n8n/workflows/retrieval.json']) { JSON.parse(require('node:fs').readFileSync(file, 'utf8')); } console.log('workflow json ok')"` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅


## Task 10 Ingestion Webhook Response Contract Fix (2026-07-06)
- Replaced the ingestion workflow webhook response payload with an app-compatible start result containing `executionId`, optional `workflowId`, `status`, and `message`.
- Removed document summary fields from the start response so `N8nWorkflowService.startWorkflow()` continues to satisfy `n8nWorkflowStartResultSchema` for uploads/reindexing.
- Added a regression test in `tests/unit/docker-compose.test.ts` asserting the ingestion workflow response contract exposes an `executionId`-compatible field and omits summary-only fields.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts tests/unit/n8n-client.test.ts` ✅ (22/22 passing)
- `node -e "JSON.parse(require('node:fs').readFileSync('docker/n8n/workflows/ingestion.json','utf8')); console.log('workflow json ok')"` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Task 10 Async Ingestion, Stale Cleanup, and n8n API Auth Review Fixes (2026-07-06)
- Changed the ingestion workflow to branch immediately after request normalization: one branch responds with `{ executionId, workflowId, status: 'running', message }` using `$execution.id`, while the other continues PDF extraction, embedding, and Qdrant writes asynchronously.
- Added a pre-ingestion Qdrant filter delete for the current `documentId` so reindex/replacement runs clear stale tail chunks before upserting fresh points.
- Removed the fake Compose default `N8N_API_KEY`; local REST execution/status calls now require an operator-created n8n API key, and `docker/n8n/README.md` documents the required bootstrap flow.
- Extended `tests/unit/docker-compose.test.ts` to lock the async response contract, stale-point delete step, and explicit API key requirement.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts tests/unit/n8n-client.test.ts` ✅ (24/24 passing)
- `node -e "JSON.parse(require('node:fs').readFileSync('docker/n8n/workflows/ingestion.json','utf8')); JSON.parse(require('node:fs').readFileSync('docker/n8n/workflows/retrieval.json','utf8')); console.log('workflow json ok')"` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Concerns
- Local Compose still needs a one-time operator bootstrap inside n8n to create both the `OpenAI Embeddings (env)` credential and a real `N8N_API_KEY`; n8n does not auto-provision that API key through Compose/CLI.

## Task 10 Qdrant Healthcheck Startup Blocker Fix (2026-07-06)
- Removed the Qdrant container healthcheck that depended on `curl`, which is not present in `qdrant/qdrant:v1.13.6`.
- Switched `qdrant-init` to wait for Qdrant readiness from its own Node image before creating the collection, so startup no longer depends on an unavailable image binary.
- Kept Qdrant internal-only via `expose` and preserved `qdrant-init` as the only readiness gate before `n8n` and `nextjs` start.
- Updated compose tests to assert the broken healthcheck is gone and that the init script performs its own readiness wait.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Task 10 Stale Qdrant Depends-On Conditions Fix (2026-07-06)
- Removed stale `depends_on: qdrant: condition: service_healthy` entries from `n8n` and `nextjs`.
- Kept `qdrant-init` as the only startup gate for Qdrant readiness and collection verification.
- Added a regression assertion in `tests/unit/docker-compose.test.ts` to prevent reintroducing the stale service health dependency.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Task 10 Compose Bootstrap and Ingestion Memory Fixes (2026-07-06)
- Relaxed server env parsing so `N8N_API_KEY` is optional at boot while `N8N_WEBHOOK_SECRET` remains required for internal webhook auth.
- Added explicit n8n configuration handling: webhook calls can proceed without an API key, but REST API calls now fail fast with a structured `BAD_REQUEST` configuration error when `N8N_API_KEY` is missing.
- Updated health behavior and local docs so fresh Compose boot stays healthy enough to start Next.js while `/api/health` reports n8n API auth as degraded/manual-action-required until an operator provisions the real key.
- Removed duplicated `extractedText` from per-chunk ingestion items and from Qdrant point payloads so only chunk content and required metadata flow downstream.
- Extended targeted tests to lock the optional API-key bootstrap path, structured config failures, degraded health messaging, and the no-`extractedText` workflow payload invariant.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts tests/unit/config-env.test.ts tests/unit/n8n-client.test.ts tests/unit/health-service.test.ts` ✅ (44/44 passing)
- `node -e "for (const file of ['docker/n8n/workflows/ingestion.json','docker/n8n/workflows/retrieval.json']) { JSON.parse(require('node:fs').readFileSync(file, 'utf8')); } console.log('workflow json ok')"` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Concerns
- Fresh local bootstrap still requires a one-time operator action inside n8n to create the REST API key; until then, REST-backed health/execution-status features correctly remain degraded.

## Task 10 Qdrant Healthcheck Startup Blocker Fix (2026-07-06)
- Removed the Qdrant container healthcheck that depended on `curl`, which is not present in `qdrant/qdrant:v1.13.6`.
- Switched `qdrant-init` to wait for Qdrant readiness from its own Node image before creating the collection, so startup no longer depends on an unavailable image binary.
- Kept Qdrant internal-only via `expose` and preserved `qdrant-init` as the only readiness gate before `n8n` and `nextjs` start.
- Updated compose tests to assert the broken healthcheck is gone and that the init script performs its own readiness wait.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Task 10 Qdrant Point ID and n8n Credential Bootstrap Fixes (2026-07-06)
- Switched ingestion workflow Qdrant point generation from `${documentId}:${chunkIndex}` strings to `crypto.randomUUID()` so upserts use valid Qdrant point IDs while keeping `documentId` and `chunkIndex` in the payload for filtering and citations.
- Replaced imported `httpHeaderAuth` credential dependencies in both embedding HTTP Request nodes with env-backed `Authorization` headers derived from `OPENAI_API_KEY`, making workflow imports bootstrap-safe.
- Updated `docker/n8n/README.md` to remove the manual OpenAI credential creation step and clarify that OpenAI secrets stay server-side in container env.
- Extended `tests/unit/docker-compose.test.ts` with regression coverage for UUID point IDs and credential-free env-backed OpenAI auth.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅ (22/22 passing)
- `node -e "JSON.parse(require('node:fs').readFileSync('docker/n8n/workflows/ingestion.json','utf8')); JSON.parse(require('node:fs').readFileSync('docker/n8n/workflows/retrieval.json','utf8')); console.log('workflow json parse ok')"` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Concerns
- Fresh local bootstrap still requires a one-time operator action to create an `N8N_API_KEY` for n8n REST API access; this change removes only the imported OpenAI credential dependency.

## Task 10 Qdrant Healthcheck and Vector Consistency Fixes (2026-07-06)
- Added a Compose-level Qdrant healthcheck that avoids missing HTTP tooling by checking for a listening port via `/proc/net/tcp`, while keeping `qdrant-init` as the authoritative readiness and collection bootstrap gate.
- Reworked the ingestion workflow to generate deterministic valid UUID point IDs from `documentId` + `chunkIndex`, so repeated upserts converge on the same chunk IDs and satisfy Qdrant UUID validation.
- Added a per-run `ingestionRunId` at request normalization, propagated it through chunking and point payload construction, and persisted it into Qdrant payload metadata.
- Replaced the pre-ingestion document-wide delete with post-upsert stale-point cleanup that removes points for the same `documentId` whose `ingestionRunId` does not match the current run.
- Updated `tests/unit/docker-compose.test.ts` to lock the new healthcheck, deterministic UUID generation, `ingestionRunId` payload, async branch wiring, and stale-point cleanup behavior.

### Verification
- `pnpm vitest run tests/unit/docker-compose.test.ts` ✅ (22/22 passing)
- `node -e "for (const file of ['docker/n8n/workflows/ingestion.json','docker/n8n/workflows/retrieval.json']) { JSON.parse(require('node:fs').readFileSync(file, 'utf8')); } console.log('workflow json parse ok')"` ✅
- `docker compose config --quiet` ✅
- `pnpm typecheck` ✅

## Concerns
- The Qdrant healthcheck is intentionally a low-level listening-port probe; real HTTP readiness and collection validation still live in `qdrant-init`, which remains the stronger startup gate.
