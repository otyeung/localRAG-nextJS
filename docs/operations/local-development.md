# Local development

## Prerequisites

- Node.js 22.x
- pnpm
- Docker + Docker Compose
- A writable local upload directory
- Optional: real `OPENAI_API_KEY` for live corpus validation

## 1. Install dependencies

```bash
pnpm install
```

## 2. Configure the environment

```bash
cp .env.example .env
mkdir -p .local/uploads
```

Compose reads `.env` for the supported full-stack path. If you also run `pnpm dev` on the host, mirror the same values into `.env.local`.

Recommended upload-directory override:

```bash
TEMP_UPLOAD_DIRECTORY=.local/uploads
```

Provide real values for:

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `N8N_BASE_URL`
- `N8N_WEBHOOK_SECRET`
- `QDRANT_URL`
- `ANONYMOUS_COOKIE_SECRET`

Leave `N8N_API_KEY` blank unless an administrator has provisioned a real n8n API key outside this stack. If you add or rotate that key later, restart `nextjs` and `n8n` so the containers pick it up.

## 3. Start infrastructure

Use the checked-in full-stack path for end-to-end local development:

```bash
docker compose up -d
docker compose ps
```

This is the supported path because the committed Compose file keeps `n8n` and `qdrant` on the internal Docker network while exposing `nextjs` on `3000` and PostgreSQL on `5432`.

## 4. Apply Prisma migrations

```bash
docker compose exec nextjs pnpm prisma migrate dev
```

If you only need generated client artifacts after the database is already migrated:

```bash
docker compose exec nextjs pnpm prisma generate
```

## 5. Seed the bundled PDF corpus

After an administrator provisions `N8N_API_KEY` in `.env` and restarts the stack, run:

```bash
docker compose exec nextjs pnpm seed:corpus
```

This processes:

- `1706.03762v7.pdf`
- `cymbal-starlight-2024.pdf`

The seed script is idempotent by file hash and uses the same ingestion path as normal uploads. If you want to run `pnpm seed:corpus` on the host instead, you must first override the env vars to host-reachable n8n and Qdrant endpoints.

## 6. Start the app

### Host mode (optional)

```bash
pnpm dev --hostname 0.0.0.0 --port 3000
```

Use host mode only when your env vars point at services reachable from the host process. With the checked-in Compose defaults, `N8N_BASE_URL=http://n8n:5678` and `QDRANT_URL=http://qdrant:6333` are internal-only service names, so host mode requires alternate endpoints or forwarded ports not provided by default.

### Docker Compose mode

`nextjs` already runs `pnpm dev --hostname 0.0.0.0 --port 3000` inside the compose stack.

## 7. Smoke checks

```bash
pnpm typecheck
pnpm test:unit
curl -s http://127.0.0.1:3000/api/health | cat
```

Healthy local runs should show:

- Next.js reachable on `http://127.0.0.1:3000`
- PostgreSQL queryable via Prisma
- Qdrant collection available
- n8n healthy or degraded only because `N8N_API_KEY` is intentionally unset

## Troubleshooting

- **n8n degraded in `/api/health`:** expected when `N8N_API_KEY` is blank; webhook-only mode still works.
- **Seed corpus times out:** verify `docker compose ps`, then confirm `n8n`, `qdrant`, and `postgres` are healthy.
- **Playwright upload temp files:** ensure `TEMP_UPLOAD_DIRECTORY` points to a writable project-local path.
