# n8n workflow assets

These workflow exports are imported automatically by the `n8n` service in `docker-compose.yml`.
They are exported as active workflows so a fresh `docker compose up` registers the production webhook endpoints.

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
- n8n does not auto-provision REST API keys in Compose. `nextjs` can still boot without `N8N_API_KEY`, but `/api/health` will report n8n API auth as degraded until an operator generates and supplies a real key.

## OpenAI authentication

The OpenAI embedding request nodes set the `Authorization` header from `OPENAI_API_KEY` at runtime inside the n8n container. Fresh imports work without creating any n8n credential records first, and workflow re-imports cannot break a manual credential relink because there is no credential dependency to preserve.

Because the header is resolved server-side from container environment variables, the secret stays inside server-side/container-side traffic.

## Required operator bootstrap

`docker compose up` does not require `N8N_API_KEY` for Next.js to start or for internal webhook execution to work.

If an operator provisions an n8n REST API key outside the app request path, export that value as `N8N_API_KEY` in the Compose environment and restart `nextjs` (or recreate the container). Until then, the app can still invoke internal webhook endpoints with `N8N_WEBHOOK_SECRET`, but n8n REST execution/status calls return a configuration error and health remains degraded.
