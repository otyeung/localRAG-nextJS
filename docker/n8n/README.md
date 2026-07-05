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
- n8n does not auto-provision REST API keys in Compose. Before `nextjs` can become ready, an operator must generate an n8n API key and supply it as `N8N_API_KEY`.

## OpenAI credential expectation

The HTTP request nodes reference an n8n credential named `OpenAI Embeddings (env)`. In local n8n, create that credential as an HTTP Header Auth credential with:

- Header name: `Authorization`
- Header value: `Bearer {{$env.OPENAI_API_KEY}}`

This keeps the secret in environment variables instead of workflow JSON.

## Required operator bootstrap

1. Start the stack with a temporary localhost-only n8n editor binding (for example via a one-off Compose override that maps `127.0.0.1:5678:5678`).
2. Open n8n, create the `OpenAI Embeddings (env)` credential, then generate an API key from **Settings → n8n API**.
3. Export that value as `N8N_API_KEY` in your Compose environment and restart `nextjs`.

Without an operator-created `N8N_API_KEY`, the app cannot authenticate n8n REST execution/status calls and should not be considered ready.

## Host access

`docker compose up` does not publish `n8n` or `qdrant` ports by default. If you need temporary localhost-only access to the n8n editor for setup, use a one-off compose override or profile that binds `127.0.0.1:5678`, then remove it after setup.
