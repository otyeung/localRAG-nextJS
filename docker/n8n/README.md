# n8n workflow assets

These workflow exports are imported automatically by the `n8n` service in `docker-compose.yml`.

## Included workflows

- `ingestion.json` → `ingestion`
- `retrieval.json` → `retrieval`

## Local wiring assumptions

- `nextjs` writes uploaded files to `/data/uploads`.
- `n8n` mounts the same shared `app_data` volume at `/data` and reads the absolute `filePath` passed by the app.
- `QDRANT_URL`, `QDRANT_COLLECTION`, `QDRANT_VECTOR_SIZE`, `QDRANT_DISTANCE`, `OPENAI_API_KEY`, and `OPENAI_MODEL` are provided through container environment variables.
- Next.js talks to n8n over the internal Docker network at `http://n8n:5678`; workflow URLs stay server-side.

## OpenAI credential expectation

The HTTP request nodes reference an n8n credential named `OpenAI Embeddings (env)`. In local n8n, create that credential as an HTTP Header Auth credential with:

- Header name: `Authorization`
- Header value: `Bearer {{$env.OPENAI_API_KEY}}`

This keeps the secret in environment variables instead of workflow JSON.
