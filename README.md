# localRAG-nextJS

Production-grade enterprise RAG foundation built with Next.js 15, React 19, OpenAI Agents SDK, Vercel AI SDK UI, Prisma, PostgreSQL, n8n, and Qdrant.

## Executive Summary & Business Impact

This repository delivers a private document-intelligence foundation that keeps the browser talking only to Next.js while Next.js brokers retrieval, ingestion, persistence, and workflow orchestration. Teams can run the stack locally, seed the two bundled PDFs through the real ingestion path, ask grounded questions in a ChatGPT-style UI, and inspect health, upload, and workflow state without exposing n8n, OpenAI secrets, or database credentials to the client.

Business-wise, the app proves the core enterprise RAG loop end to end: confidential uploads, indexed corpus management, streaming answers with citations, and operational controls for health, workflow state, and auditability. It is intentionally a complete vertical slice rather than a partial demo, giving product and engineering stakeholders a deployable baseline for future document AI features.

## Tech Stack

- **Framework:** Next.js 15 App Router, React 19, TypeScript
- **AI orchestration:** `@openai/agents`, `@openai/agents-extensions`, AI SDK UI
- **Data layer:** Prisma, PostgreSQL
- **Retrieval pipeline:** n8n workflows, Qdrant
- **UI:** Tailwind CSS, Radix UI primitives, TanStack Query, React Hook Form, Zod
- **Observability & security:** Pino, request IDs, CSP middleware, CSRF checks, rate limiting, audit logs
- **Testing:** Vitest, Testing Library, Playwright
- **Delivery:** pnpm, Docker, Docker Compose

## Architectural References

- OpenAI Agents + AI SDK UI example: <https://github.com/openai/openai-agents-js/tree/main/examples/ai-sdk-ui>
- n8n + local RAG reference: <https://github.com/otyeung/localRAG>

## Architecture

At runtime the browser communicates only with Next.js routes under `app/api/*`. Those routes validate requests, resolve the anonymous signed-cookie user, apply authorization and rate limits, persist application state in PostgreSQL through Prisma repositories/services, and stream agent responses back through AI SDK UI.

For ingestion and retrieval, Next.js calls the typed service layer in `lib/n8n/*`, which uses internal-only Docker networking, `X-N8N-API-KEY` authentication when provisioned, and webhook-secret validation to reach the committed n8n workflows. Qdrant stores vector payloads; PostgreSQL remains the system of record for conversations, messages, documents, uploads, workflow executions, agent runs, tool calls, audit logs, and settings.

Key product surfaces in this slice:

- ChatGPT-style shell with sidebar, chat workspace, knowledge base, settings, and system status
- Streaming chat backed by `GeneralAssistantAgent`, `DocumentAgent`, and `RetrievalAgent`
- Upload, indexing, reindex, search, and workflow-status visibility for the knowledge base
- Health reporting for app, database, n8n, Qdrant, and OpenAI configuration

## Local Development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create a Compose environment file and provide secrets:

   ```bash
   cp .env.example .env
   mkdir -p .local/uploads
   ```

   If you also run the app on the host, mirror the same values into `.env.local`. Recommended upload-directory override:

   ```bash
   TEMP_UPLOAD_DIRECTORY=.local/uploads
   ```

3. Start the full local stack:

   ```bash
   docker compose up -d
   ```

4. Apply Prisma migrations:

   ```bash
   docker compose exec nextjs pnpm prisma migrate dev
   ```

5. Seed the bundled corpus through the real upload/ingestion flow:

   ```bash
   docker compose exec nextjs pnpm seed:corpus
   ```

6. Optional host-run mode for app-only work:

   ```bash
   pnpm dev --hostname 0.0.0.0 --port 3000
   ```

   Use host-run mode only when your environment variables point to reachable services outside the internal Docker network. The checked-in Compose stack keeps `n8n` and `qdrant` internal-only, so the supported end-to-end path is `docker compose up -d`.

See `docs/operations/local-development.md` for a fuller runbook.

## Docker Compose

`docker-compose.yml` defines:

- `nextjs`
- `postgres`
- `qdrant`
- `qdrant-init`
- `n8n`
- `redis`

Bring up the full stack with:

```bash
docker compose up -d
docker compose ps
```

The stack keeps `n8n` and `qdrant` internal by default. `nextjs` is published on port `3000`, PostgreSQL is published on `5432` for local connectivity, and `qdrant-init` pre-creates the configured collection before the app and n8n depend on it.

## Environment Configuration

Required variables are documented in `.env.example`:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_EMBEDDING_MODEL`
- `DATABASE_URL`
- `N8N_BASE_URL`
- `N8N_WEBHOOK_SECRET`
- `QDRANT_URL`
- `QDRANT_COLLECTION`
- `QDRANT_VECTOR_SIZE`
- `QDRANT_DISTANCE`
- `ANONYMOUS_COOKIE_SECRET`

Operational notes:

- `N8N_API_KEY` is intentionally optional for local webhook-only mode; leave it blank unless an administrator provisions a real key outside this stack.
- `TEMP_UPLOAD_DIRECTORY` should point to writable storage isolated from the browser and external services.
- `LOG_LEVEL`, `MAX_UPLOAD_SIZE`, `N8N_TIMEOUT`, `N8N_RETRY_COUNT`, and `N8N_RETRY_DELAY` control runtime behavior without code changes.

## Seeded PDF Corpus

The foundation slice ships with two PDFs in the repository root:

- `1706.03762v7.pdf`
- `cymbal-starlight-2024.pdf`

After an administrator provisions `N8N_API_KEY` in the Compose environment and restarts the relevant services, seed them on the supported Compose stack with:

```bash
docker compose exec nextjs pnpm seed:corpus
```

The seed flow is idempotent by file hash, writes uploads/documents/workflow records for the seeded anonymous user, and exercises the same ingestion service used by normal uploads. A host-run `pnpm seed:corpus` is only suitable when your env vars already point to host-reachable n8n and Qdrant endpoints.

## RAG Validation Questions

Use the seeded corpus to validate grounded retrieval:

1. `1706.03762v7.pdf` — *What specific hardware setup and optimizer were used to train the base and big Transformer models? Additionally, how long did the training take for each model, and what were their final BLEU scores on the WMT 2014 English-to-German dataset?*
2. `cymbal-starlight-2024.pdf` — *What is the cargo capacity of Cymbal Starlight?*

Expected validation outcome: answers should be grounded in retrieved chunks, stream back through chat, and include citations pointing to the relevant document metadata.

## Security Model

- Secrets are read server-side only from `lib/config/env.ts`; OpenAI, database, and n8n credentials never reach the browser.
- `middleware.ts` injects CSP, request IDs, `nosniff`, and strict referrer-policy headers.
- Cookie-backed mutation flows enforce same-origin CSRF protection.
- In-memory route rate limiting protects chat, upload, search, and workflow retry paths.
- Upload validation checks extension, MIME type, and max size before ingestion.
- The virus-scan seam exists in `VirusScanService`; the current local implementation is a no-op adapter that can be replaced by a real scanner.
- Anonymous user cookies are HMAC-signed, and sensitive actions are audit-loggable through `AuditService`.

See `docs/operations/security.md` for the operational checklist.

## n8n Internal Service Model

The browser never calls n8n directly. Instead:

1. Next.js route handlers validate input and resolve user/request context.
2. Application services call typed clients in `lib/n8n/*`.
3. Those clients talk to internal-only n8n endpoints over the Docker network.
4. n8n runs ingestion/retrieval workflows, while Next.js validates responses and persists durable state.

This preserves a clean security boundary: workflow internals, execution payloads, and credentials stay inside server-to-server paths.

## Testing

Core verification commands:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
docker compose config --quiet
pnpm test:e2e
```

Additional notes:

- `pnpm test:e2e` runs the mocked UI suite by default.
- Live corpus validation is guarded by `LOCALRAG_LIVE_CORPUS_TESTS=1` plus healthy `database`, `n8n`, `qdrant`, a real `OPENAI_API_KEY`, and a provisioned `N8N_API_KEY`.
- Docker contract coverage also exists in `tests/unit/docker-compose.test.ts`.

See `docs/operations/testing.md` for detailed guidance.

## Future Enhancements

Later iterations should extend the current slice with the full planned product surface:

- Full document type support beyond the seeded PDFs
- Full right inspector
- Conversation export/import
- Advanced knowledge base preview and metadata views
- Advanced workflow dashboard
- Advanced execution dashboard
- Advanced upload dashboard
- Summarization agent
- Extraction agent
- Search agent
- `searchKnowledgeBase()`
- `uploadDocument()` as an agent tool
- `deleteDocument()` as an agent tool with explicit authorization
- `summarizeDocument()`
- `extractEntities()`
- Admin-grade settings console
- Rich document preview for every file type
- Admin settings and enterprise identity providers
- Production queue workers if ingestion volume requires separation from route handlers
