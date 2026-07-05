import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  webServer: {
    command: 'pnpm exec next dev --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      ...(!process.env.OPENAI_API_KEY && process.env.LOCALRAG_LIVE_CORPUS_TESTS !== '1'
        ? { OPENAI_API_KEY: 'sk-playwright' }
        : {}),
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/localrag_nextjs?schema=public',
      N8N_BASE_URL: process.env.N8N_BASE_URL ?? 'http://127.0.0.1:5678',
      N8N_WEBHOOK_SECRET: process.env.N8N_WEBHOOK_SECRET ?? 'playwright-webhook-secret',
      QDRANT_URL: process.env.QDRANT_URL ?? 'http://127.0.0.1:6333',
      ANONYMOUS_COOKIE_SECRET:
        process.env.ANONYMOUS_COOKIE_SECRET ?? 'playwright-anonymous-cookie-secret',
      TEMP_UPLOAD_DIRECTORY: process.env.TEMP_UPLOAD_DIRECTORY ?? '.playwright/uploads',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
});
