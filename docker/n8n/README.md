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

## OpenAI credential expectation

The HTTP request nodes reference an n8n credential named `OpenAI Embeddings (env)`. In local n8n, create that credential as an HTTP Header Auth credential with:

- Header name: `Authorization`
- Header value: `Bearer {{$env.OPENAI_API_KEY}}`

This keeps the secret in environment variables instead of workflow JSON.

## Host access

`docker compose up` does not publish `n8n` or `qdrant` ports by default. If you need temporary localhost-only access to the n8n editor for setup, use a one-off compose override or profile that binds `127.0.0.1:5678`, then remove it after setup.
