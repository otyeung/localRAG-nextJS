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
