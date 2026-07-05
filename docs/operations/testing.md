# Testing operations

## Standard verification commands

Run the Task 12 verification set from the repository root:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
docker compose config --quiet
pnpm test:e2e
```

## Test suite breakdown

### Unit tests

```bash
pnpm test:unit
```

Covers configuration, middleware, CSRF, rate limiting, repositories, Prisma wiring, n8n clients, UI components, hooks, and Docker contract assertions.

### Integration tests

```bash
pnpm test:integration
```

Covers repository/service integration, seed-corpus behavior, retrieval plumbing, API route contracts, and live-corpus preflight logic.

### Playwright E2E

```bash
pnpm test:e2e
```

Default behavior validates the UI shell and mocked streaming/upload flows. Live corpus validation is opt-in.

## Live corpus validation

To exercise the real seeded corpus and retrieval stack:

```bash
LOCALRAG_LIVE_CORPUS_TESTS=1 \
N8N_BASE_URL=http://127.0.0.1:5678 \
QDRANT_URL=http://127.0.0.1:6333 \
pnpm test:e2e

LOCALRAG_LIVE_CORPUS_TESTS=1 \
N8N_BASE_URL=http://127.0.0.1:5678 \
QDRANT_URL=http://127.0.0.1:6333 \
pnpm test:integration
```

Prerequisites:

- real `OPENAI_API_KEY`
- provisioned `N8N_API_KEY`
- healthy PostgreSQL
- healthy n8n
- healthy Qdrant
- seeded corpus present

The checked-in Compose stack does not publish n8n or Qdrant directly, so the host commands above require operator-managed port forwarding or temporary exposure of those services first. They are intentionally not runnable on the default stack without that extra setup. Without a real admin-provisioned `N8N_API_KEY`, the app can still boot, but `/api/health` reports n8n as degraded and live corpus checks that rely on API-backed seed/workflow polling remain unavailable.

The live checks verify:

- the two bundled PDFs are indexed
- grounded chunks can be retrieved for both validation questions
- streaming chat returns citations tied to the correct document

## Docker validation

Use both static and runtime checks:

```bash
docker compose config --quiet
docker compose up -d
docker compose ps
```

Expected services:

- `nextjs`
- `postgres`
- `n8n`
- `qdrant`
- `redis` when enabled

## Failure triage

- **`pnpm build` / `pnpm typecheck` fails:** fix compile-time issues before any runtime tests.
- **`pnpm lint` fails:** resolve route/component/config lint errors before shipping docs or code together.
- **`pnpm test:e2e` skips live corpus checks:** verify `LOCALRAG_LIVE_CORPUS_TESTS=1`, health dependencies, and a usable OpenAI key.
- **`docker compose up -d` unhealthy services:** inspect `docker compose ps` and container logs before retrying corpus seeding or E2E.
