# n8n workflow assets

These workflow exports are imported automatically by the `n8n` service in `docker-compose.yml`.
The service then runs `n8n update:workflow --all --active=true` before `n8n start`, because `n8n import:workflow` deactivates imported workflows by default on single-main instances.

## Included workflows

- `ingestion.json` → `ingestion`
- `retrieval.json` → `retrieval`

## Local wiring assumptions

- `nextjs` writes uploaded files to `/data/uploads`.
- `n8n` mounts the same shared `app_data` volume at `/data` and reads the absolute `filePath` passed by the app.
- `QDRANT_URL`, `QDRANT_COLLECTION`, `QDRANT_VECTOR_SIZE`, `QDRANT_DISTANCE`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, and `N8N_WEBHOOK_SECRET` are provided through container environment variables.
- `qdrant-init` verifies or creates the configured collection before `n8n` and `nextjs` start.
- `n8n` and `qdrant` stay internal to the Docker network by default; only `nextjs` is published to the host.
- Next.js talks to n8n over the internal Docker network at `http://n8n:5678`; workflow URLs stay server-side and each webhook request must include the internal `x-n8n-webhook-secret` header.
- n8n does not auto-provision REST API keys in Compose. `nextjs` can still boot without `N8N_API_KEY`, but `/api/health` will report n8n API auth as degraded until an operator supplies a real key through an external admin path.

## OpenAI authentication

The OpenAI embedding request nodes set the `Authorization` header from `OPENAI_API_KEY` at runtime inside the n8n container. Fresh imports work without creating any n8n credential records first, and workflow re-imports cannot break a manual credential relink because there is no credential dependency to preserve.

Because the header is resolved server-side from container environment variables, the secret stays inside server-side/container-side traffic.

## Compose bootstrap behavior

`docker compose up` does not require `N8N_API_KEY` for Next.js to start or for internal webhook execution to work. The supported local path is:

1. Compose starts `postgres`, `qdrant`, and `qdrant-init`.
2. The `n8n` container imports the committed workflows and activates them with the CLI before `n8n start`.
3. `nextjs` calls only the internal `/webhook/ingestion` and `/webhook/retrieval` endpoints with `N8N_WEBHOOK_SECRET`.

This repository does not provide a supported CLI or environment-variable path to create n8n API keys. Current n8n docs only document API-key creation from authenticated UI settings, and this stack intentionally does not publish n8n to the host.

For local startup, leave `N8N_API_KEY` unset. In that webhook-only mode, ingestion and retrieval still work, while REST-backed execution/status checks stay degraded.

If an administrator provisions an n8n REST API key outside this stack, export that value as `N8N_API_KEY` in the Compose environment and restart `nextjs` (or recreate the container) to enable API-backed health and status checks.
