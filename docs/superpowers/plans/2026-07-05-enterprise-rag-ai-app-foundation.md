# Enterprise RAG AI App Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-ready vertical slice of a single-repository Next.js RAG application that ingests the two provided PDFs through n8n/Qdrant, persists state in Postgres, and streams grounded OpenAI Agents SDK chat responses through AI SDK UI.

**Architecture:** The browser calls only Next.js App Router pages and API routes. Next.js owns authentication, authorization, uploads, chat streaming, conversations, database writes, logging, security, and orchestration; n8n and Qdrant are internal Docker-network services reached only through typed server-side service layers.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, OpenAI Agents SDK, OpenAI Responses API, Vercel AI SDK UI, n8n, Tailwind CSS, shadcn/ui, React Hook Form, Zod, Prisma, PostgreSQL, Qdrant, Docker Compose, pnpm, Vitest, Playwright, ESLint, Prettier, Pino, TanStack Query.

## Global Constraints

- The app lives in one repository under `/Users/dyeung/repo/technology_learning/056-RAG/localRAG-nextJS`.
- The current directory contains `1706.03762v7.pdf`, `cymbal-starlight-2024.pdf`, and design docs; preserve those files.
- The browser must never communicate directly with n8n, Qdrant, OpenAI, or Postgres.
- n8n is an internal orchestration engine, not the public API.
- Use Qdrant alongside Postgres because the selected design follows the localRAG vector-store shape.
- Use an anonymous local user abstraction now, with interfaces that allow migration to NextAuth, OAuth, OpenAI Auth, Google, GitHub, or Azure AD.
- Do not ship inert stubs for out-of-scope agents/tools/dashboards; document planned capabilities in README instead.
- Keep OpenAI, n8n, Postgres, and Qdrant credentials server-only.
- Every route crossing a trust boundary uses Zod validation and structured errors.
- Every sensitive mutation writes an audit log.
- `docker compose up` must start `nextjs`, `postgres`, `n8n`, `qdrant`, and optional `redis`.
- The two provided PDFs must be seeded through the same ingestion path as normal uploads.
- The corpus questions from the spec must pass through streaming chat with citations.
- Validate with `pnpm build`, type checking, ESLint, unit tests, integration tests, Playwright tests, and Docker local startup.
- Include the commit trailer on implementation commits: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- When implementation is complete, create or verify a public GitHub repository named `localRAG-nextJS`, use the Apache License 2.0, commit all final changes, push to the remote, merge the feature branch into the default branch, push the merge, clean up any linked worktree/feature branch state that is safe to remove, start the local development server, and leave it running for user testing.

---

## File Structure Map

Create this structure. Each file has one primary responsibility.

```text
app/
  api/
    chat/route.ts                  # AI SDK UI streaming chat entry point
    conversations/route.ts          # list/create conversations
    conversations/[id]/route.ts     # read/rename/delete one conversation
    documents/route.ts              # list/search documents
    documents/[id]/route.ts         # read/delete/reindex one document
    health/route.ts                 # system health
    messages/route.ts               # list persisted messages
    search/route.ts                 # conversation/document search
    settings/route.ts               # get/update settings
    upload/route.ts                 # multipart upload entry point
    uploads/route.ts                # upload queue/history
    workflows/route.ts              # workflow list/status
    workflows/[id]/route.ts         # single workflow execution status
  globals.css
  layout.tsx
  page.tsx
agents/
  document-agent.ts                 # document-aware agent
  general-assistant-agent.ts        # default agent
  registry.ts                       # active agent lookup
  retrieval-agent.ts                # retrieval-focused agent
  tools/
    conversation-history.ts
    list-documents.ts
    retrieve-chunks.ts
    search-conversation.ts
    workflow-status.ts
components/
  chat/
  common/
  documents/
  providers/
  settings/
  sidebar/
  upload/
hooks/
  use-conversations.ts
  use-documents.ts
  use-health.ts
  use-upload-queue.ts
lib/
  auth/
  config/
  db/
  http/
  logger/
  n8n/
  openai/
  qdrant/
  repositories/
  security/
  services/
  utils/
prisma/
  schema.prisma
  migrations/
scripts/
  seed-corpus.ts
tests/
  api/
  components/
  e2e/
  fixtures/
  integration/
  unit/
docker/
  n8n/
    workflows/
      ingestion.json
      retrieval.json
```

---

### Task 1: Project Bootstrap, Tooling, and Repository Baseline

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `prettier.config.mjs`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `postcss.config.mjs`
- Create: `tailwind.config.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`
- Create: `tests/unit/project-config.test.ts`

**Interfaces:**
- Produces npm scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:unit`, `test:integration`, `test:e2e`, `prisma:generate`, `prisma:migrate`, `seed:corpus`.
- Produces import alias `@/*`.
- Produces strict TypeScript baseline consumed by every later task.

- [ ] **Step 1: Initialize Git if missing**

Run:

```bash
cd /Users/dyeung/repo/technology_learning/056-RAG/localRAG-nextJS
git rev-parse --is-inside-work-tree || git init
```

Expected: either `true` or a new Git repository initialized in the current directory.

- [ ] **Step 2: Create the Next.js application baseline**

Run:

```bash
cd /Users/dyeung/repo/technology_learning/056-RAG/localRAG-nextJS
pnpm create next-app@latest . \
  --ts \
  --tailwind \
  --eslint \
  --app \
  --src-dir false \
  --import-alias "@/*" \
  --use-pnpm
```

If the command refuses because the directory is non-empty, create the files manually in the same paths while preserving the PDFs and `docs/`.

- [ ] **Step 3: Install production and test dependencies**

Run:

```bash
pnpm add @ai-sdk/react @hookform/resolvers @openai/agents @openai/agents-extensions @prisma/client @qdrant/js-client-rest @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-label @radix-ui/react-popover @radix-ui/react-scroll-area @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-switch @tanstack/react-query ai class-variance-authority clsx date-fns file-type lucide-react nanoid next-themes pino react-hook-form react-markdown rehype-highlight rehype-katex remark-gfm remark-math server-only tailwind-merge zod
pnpm add -D @playwright/test @testing-library/jest-dom @testing-library/react @types/node @types/react @types/react-dom jsdom pino-pretty prettier prisma tailwindcss-animate tsx vitest
```

Expected: dependencies install successfully and `pnpm-lock.yaml` is created.

- [ ] **Step 4: Write the project config test**

Create `tests/unit/project-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json';

describe('project configuration', () => {
  it('exposes required lifecycle scripts', () => {
    expect(packageJson.scripts).toMatchObject({
      build: expect.any(String),
      dev: expect.any(String),
      lint: expect.any(String),
      start: expect.any(String),
      typecheck: expect.any(String),
      test: expect.any(String),
      'test:e2e': expect.any(String),
      'test:integration': expect.any(String),
      'test:unit': expect.any(String),
      'prisma:generate': expect.any(String),
      'prisma:migrate': expect.any(String),
      'seed:corpus': expect.any(String),
    });
  });

  it('pins the required framework families', () => {
    expect(packageJson.dependencies.next).toMatch(/^(\^|~)?15\./);
    expect(packageJson.dependencies.react).toMatch(/^(\^|~)?19\./);
    expect(packageJson.dependencies['react-dom']).toMatch(/^(\^|~)?19\./);
  });
});
```

- [ ] **Step 5: Run the config test and confirm failure before scripts are corrected**

Run:

```bash
pnpm vitest run tests/unit/project-config.test.ts
```

Expected: fail if any required script or dependency family is missing.

- [ ] **Step 6: Update scripts and config**

Set `package.json` scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit tests/components",
    "test:integration": "vitest run tests/integration tests/api",
    "test:e2e": "playwright test",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "seed:corpus": "tsx scripts/seed-corpus.ts"
  }
}
```

Set `.env.example`:

```text
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
DATABASE_URL=postgresql://app:app_password@postgres:5432/localrag_nextjs?schema=public
N8N_BASE_URL=http://n8n:5678
N8N_API_KEY=
N8N_TIMEOUT=30000
N8N_RETRY_COUNT=3
N8N_RETRY_DELAY=500
LOG_LEVEL=info
MAX_UPLOAD_SIZE=52428800
TEMP_UPLOAD_DIRECTORY=/tmp/localrag-nextjs/uploads
QDRANT_URL=http://qdrant:6333
QDRANT_COLLECTION=documents
QDRANT_VECTOR_SIZE=1536
QDRANT_DISTANCE=Cosine
POSTGRES_USER=app
POSTGRES_PASSWORD=app_password
POSTGRES_DB=localrag_nextjs
N8N_ENCRYPTION_KEY=change-me-32-character-dev-key
N8N_USER_MANAGEMENT_JWT_SECRET=change-me-n8n-jwt-secret
REDIS_URL=redis://redis:6379
```

- [ ] **Step 7: Verify baseline**

Run:

```bash
pnpm vitest run tests/unit/project-config.test.ts
pnpm typecheck
pnpm lint
```

Expected: all pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add .gitignore .env.example package.json pnpm-lock.yaml next.config.ts tsconfig.json eslint.config.mjs prettier.config.mjs vitest.config.ts playwright.config.ts postcss.config.mjs tailwind.config.ts app tests
git commit -m "chore: bootstrap enterprise rag app" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Environment, Logging, HTTP Errors, Security Primitives

**Files:**
- Create: `lib/config/env.ts`
- Create: `lib/logger/logger.ts`
- Create: `lib/http/request-context.ts`
- Create: `lib/http/api-response.ts`
- Create: `lib/http/api-errors.ts`
- Create: `lib/security/rate-limit.ts`
- Create: `lib/security/csrf.ts`
- Create: `middleware.ts`
- Test: `tests/unit/config-env.test.ts`
- Test: `tests/unit/api-errors.test.ts`
- Test: `tests/unit/rate-limit.test.ts`

**Interfaces:**
- Produces `env: AppEnv`.
- Produces `getRequestContext(request: Request): RequestContext`.
- Produces `jsonOk<T>(data: T, init?: ResponseInit): Response`.
- Produces `jsonError(error: AppError, requestId: string): Response`.
- Produces `rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult>`.
- Later route handlers consume these helpers.

- [ ] **Step 1: Write failing env validation test**

Create `tests/unit/config-env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEnv } from '@/lib/config/env';

describe('createEnv', () => {
  it('parses required server configuration', () => {
    const env = createEnv({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4.1-mini',
      DATABASE_URL: 'postgresql://app:pw@localhost:5432/db',
      N8N_BASE_URL: 'http://n8n:5678',
      N8N_API_KEY: 'n8n-test',
      N8N_TIMEOUT: '30000',
      N8N_RETRY_COUNT: '3',
      N8N_RETRY_DELAY: '500',
      LOG_LEVEL: 'info',
      MAX_UPLOAD_SIZE: '52428800',
      TEMP_UPLOAD_DIRECTORY: '/tmp/uploads',
      QDRANT_URL: 'http://qdrant:6333',
      QDRANT_COLLECTION: 'documents',
      QDRANT_VECTOR_SIZE: '1536',
      QDRANT_DISTANCE: 'Cosine',
    });

    expect(env.n8n.timeoutMs).toBe(30000);
    expect(env.upload.maxBytes).toBe(52_428_800);
    expect(env.qdrant.collection).toBe('documents');
  });

  it('rejects invalid URLs and numeric values', () => {
    expect(() =>
      createEnv({
        OPENAI_API_KEY: 'sk-test',
        OPENAI_MODEL: 'gpt-4.1-mini',
        DATABASE_URL: 'not-a-url',
        N8N_BASE_URL: 'http://n8n:5678',
        N8N_API_KEY: 'n8n-test',
        N8N_TIMEOUT: '-1',
        N8N_RETRY_COUNT: '3',
        N8N_RETRY_DELAY: '500',
        LOG_LEVEL: 'info',
        MAX_UPLOAD_SIZE: '52428800',
        TEMP_UPLOAD_DIRECTORY: '/tmp/uploads',
        QDRANT_URL: 'http://qdrant:6333',
        QDRANT_COLLECTION: 'documents',
        QDRANT_VECTOR_SIZE: '1536',
        QDRANT_DISTANCE: 'Cosine',
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm vitest run tests/unit/config-env.test.ts
```

Expected: fail because `@/lib/config/env` does not exist.

- [ ] **Step 3: Implement environment parsing**

Create `lib/config/env.ts`:

```ts
import 'server-only';
import { z } from 'zod';

const rawEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  DATABASE_URL: z.string().url(),
  N8N_BASE_URL: z.string().url(),
  N8N_API_KEY: z.string().min(1),
  N8N_TIMEOUT: z.coerce.number().int().positive().default(30_000),
  N8N_RETRY_COUNT: z.coerce.number().int().min(0).max(10).default(3),
  N8N_RETRY_DELAY: z.coerce.number().int().positive().default(500),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MAX_UPLOAD_SIZE: z.coerce.number().int().positive().default(52_428_800),
  TEMP_UPLOAD_DIRECTORY: z.string().min(1).default('/tmp/localrag-nextjs/uploads'),
  QDRANT_URL: z.string().url(),
  QDRANT_COLLECTION: z.string().min(1).default('documents'),
  QDRANT_VECTOR_SIZE: z.coerce.number().int().positive().default(1536),
  QDRANT_DISTANCE: z.enum(['Cosine', 'Dot', 'Euclid', 'Manhattan']).default('Cosine'),
});

export type AppEnv = {
  openai: { apiKey: string; model: string };
  database: { url: string };
  n8n: { baseUrl: string; apiKey: string; timeoutMs: number; retryCount: number; retryDelayMs: number };
  logger: { level: z.infer<typeof rawEnvSchema>['LOG_LEVEL'] };
  upload: { maxBytes: number; tempDirectory: string };
  qdrant: { url: string; collection: string; vectorSize: number; distance: z.infer<typeof rawEnvSchema>['QDRANT_DISTANCE'] };
};

export function createEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = rawEnvSchema.parse(source);

  return {
    openai: { apiKey: parsed.OPENAI_API_KEY, model: parsed.OPENAI_MODEL },
    database: { url: parsed.DATABASE_URL },
    n8n: {
      baseUrl: parsed.N8N_BASE_URL.replace(/\/$/, ''),
      apiKey: parsed.N8N_API_KEY,
      timeoutMs: parsed.N8N_TIMEOUT,
      retryCount: parsed.N8N_RETRY_COUNT,
      retryDelayMs: parsed.N8N_RETRY_DELAY,
    },
    logger: { level: parsed.LOG_LEVEL },
    upload: { maxBytes: parsed.MAX_UPLOAD_SIZE, tempDirectory: parsed.TEMP_UPLOAD_DIRECTORY },
    qdrant: {
      url: parsed.QDRANT_URL.replace(/\/$/, ''),
      collection: parsed.QDRANT_COLLECTION,
      vectorSize: parsed.QDRANT_VECTOR_SIZE,
      distance: parsed.QDRANT_DISTANCE,
    },
  };
}

export const env = createEnv(process.env);
```

- [ ] **Step 4: Add errors and response helpers**

Create `lib/http/api-errors.ts`:

```ts
export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

const statusByCode: Record<AppErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message);
  }
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred.');
}
```

Create `lib/http/api-response.ts`:

```ts
import { AppError } from '@/lib/http/api-errors';

export function jsonOk<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

export function jsonError(error: AppError, requestId: string): Response {
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId,
        details: error.details,
      },
    },
    { status: error.status },
  );
}
```

Create `lib/http/request-context.ts`:

```ts
import { nanoid } from 'nanoid';

export type RequestContext = {
  requestId: string;
  ipAddress: string;
  userAgent: string;
};

export function getRequestContext(request: Request): RequestContext {
  return {
    requestId: request.headers.get('x-request-id') ?? nanoid(),
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  };
}
```

- [ ] **Step 5: Add logging and security primitives**

Create `lib/logger/logger.ts`:

```ts
import 'server-only';
import pino from 'pino';
import { env } from '@/lib/config/env';

export const logger = pino({
  level: env.logger.level,
  transport:
    process.env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: true },
        }
      : undefined,
  redact: {
    paths: ['OPENAI_API_KEY', 'N8N_API_KEY', '*.authorization', '*.apiKey', '*.password'],
    remove: true,
  },
});
```

Create `lib/security/rate-limit.ts`:

```ts
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

export async function rateLimit(key: string, policy: RateLimitPolicy): Promise<RateLimitResult> {
  const now = Date.now();
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + policy.windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: bucket.count <= policy.limit,
    remaining: Math.max(policy.limit - bucket.count, 0),
    resetAt: new Date(bucket.resetAt),
  };
}

export function clearRateLimitBucketsForTests(): void {
  buckets.clear();
}
```

Create `lib/security/csrf.ts`:

```ts
import { AppError } from '@/lib/http/api-errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) {
    return;
  }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) {
    return;
  }
  if (new URL(origin).host !== host) {
    throw new AppError('FORBIDDEN', 'Cross-origin mutation rejected.');
  }
}
```

Create `middleware.ts`:

```ts
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export function middleware(request: NextRequest): NextResponse {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const response = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  });

  response.headers.set('x-request-id', requestId);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'content-security-policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';",
  );

  return response;
}
```

- [ ] **Step 6: Verify**

Run:

```bash
pnpm vitest run tests/unit/config-env.test.ts tests/unit/api-errors.test.ts tests/unit/rate-limit.test.ts
pnpm typecheck
```

Expected: tests and type checking pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/config lib/logger lib/http lib/security middleware.ts tests/unit
git commit -m "feat: add server configuration and security primitives" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Prisma Schema, Database Client, and Repository Layer

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db/prisma.ts`
- Create: `lib/repositories/types.ts`
- Create: `lib/repositories/user-repository.ts`
- Create: `lib/repositories/conversation-repository.ts`
- Create: `lib/repositories/document-repository.ts`
- Create: `lib/repositories/workflow-repository.ts`
- Create: `lib/repositories/audit-repository.ts`
- Test: `tests/unit/prisma-schema.test.ts`
- Test: `tests/integration/repositories.test.ts`

**Interfaces:**
- Produces `prisma`.
- Produces repository classes with constructor `(db: PrismaClient | Prisma.TransactionClient)`.
- Produces `UserRepository.findOrCreateAnonymousUser(fingerprint: string): Promise<User>`.
- Produces `ConversationRepository.createForUser(userId: string, title?: string): Promise<Conversation>`.
- Produces `DocumentRepository.createUploadDocument(input: CreateUploadDocumentInput): Promise<Document>`.
- Produces `WorkflowRepository.createExecution(input: CreateWorkflowExecutionInput): Promise<WorkflowExecution>`.

- [ ] **Step 1: Write schema guard test**

Create `tests/unit/prisma-schema.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('prisma schema', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');

  it.each([
    'User',
    'Conversation',
    'Message',
    'Attachment',
    'Document',
    'ChunkMetadata',
    'EmbeddingMetadata',
    'WorkflowExecution',
    'Upload',
    'AgentRun',
    'ToolCall',
    'AuditLog',
    'Settings',
  ])('defines model %s', (modelName) => {
    expect(schema).toContain(`model ${modelName}`);
  });

  it('uses PostgreSQL through Prisma', () => {
    expect(schema).toContain('provider = "postgresql"');
  });
});
```

- [ ] **Step 2: Run failing schema test**

Run:

```bash
pnpm vitest run tests/unit/prisma-schema.test.ts
```

Expected: fail until `prisma/schema.prisma` exists with all models.

- [ ] **Step 3: Implement Prisma schema**

Create `prisma/schema.prisma` with enums and all required models. Use `String @id @default(cuid())`, `Json` metadata fields, status enums for upload/document/workflow/agent/tool states, indexes on user ownership, timestamps, workflow IDs, execution IDs, file hashes, and search fields. Include these core relation names exactly:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum UserKind {
  ANONYMOUS
}

enum ConversationStatus {
  ACTIVE
  ARCHIVED
  DELETED
}

enum MessageRole {
  SYSTEM
  USER
  ASSISTANT
  TOOL
}

enum UploadStatus {
  PENDING
  VALIDATING
  INGESTING
  COMPLETED
  FAILED
  CANCELED
}

enum DocumentStatus {
  PENDING
  INGESTING
  READY
  FAILED
  DELETED
}

enum WorkflowStatus {
  QUEUED
  RUNNING
  SUCCESS
  ERROR
  CANCELED
  WAITING
}

enum AgentRunStatus {
  RUNNING
  COMPLETED
  FAILED
  CANCELED
}

enum ToolCallStatus {
  STARTED
  COMPLETED
  FAILED
}
```

Add each model named in the test. Required fields:

```prisma
model User {
  id              String         @id @default(cuid())
  kind            UserKind       @default(ANONYMOUS)
  fingerprintHash String         @unique
  displayName     String
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  conversations   Conversation[]
  documents       Document[]
  uploads         Upload[]
  workflows       WorkflowExecution[]
  auditLogs       AuditLog[]
  settings        Settings?
}
```

Implement the remaining models with these required relations:

- `Conversation.userId -> User.id`; `Conversation.messages`; `Conversation.agentRuns`.
- `Message.conversationId -> Conversation.id`; `Message.attachments`.
- `Attachment.messageId -> Message.id`.
- `Document.userId -> User.id`; `Document.uploadId -> Upload.id`; `Document.chunks`; `Document.embeddings`; `Document.workflows`.
- `Upload.userId -> User.id`; `Upload.documents`.
- `ChunkMetadata.documentId -> Document.id`.
- `EmbeddingMetadata.documentId -> Document.id`.
- `WorkflowExecution.userId -> User.id`; optional `documentId`; optional `uploadId`.
- `AgentRun.conversationId -> Conversation.id`; `AgentRun.toolCalls`.
- `ToolCall.agentRunId -> AgentRun.id`.
- `AuditLog.userId -> User.id`.
- `Settings.userId -> User.id @unique`.

- [ ] **Step 4: Create Prisma client singleton**

Create `lib/db/prisma.ts`:

```ts
import 'server-only';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 5: Implement repositories**

Create repository files with typed methods only; no route handler imports. Example for `lib/repositories/user-repository.ts`:

```ts
import type { Prisma, PrismaClient, User } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class UserRepository {
  constructor(private readonly db: DbClient) {}

  async findOrCreateAnonymousUser(fingerprintHash: string): Promise<User> {
    return this.db.user.upsert({
      where: { fingerprintHash },
      update: {},
      create: {
        fingerprintHash,
        displayName: 'Local User',
      },
    });
  }
}
```

Use the same constructor pattern for the remaining repositories.

- [ ] **Step 6: Generate Prisma client and create migration**

Run:

```bash
pnpm prisma:generate
pnpm prisma migrate dev --name init
```

Expected: Prisma client generated and a migration appears under `prisma/migrations/`.

- [ ] **Step 7: Verify**

Run:

```bash
pnpm vitest run tests/unit/prisma-schema.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add prisma lib/db lib/repositories tests/unit/prisma-schema.test.ts tests/integration/repositories.test.ts
git commit -m "feat: add prisma schema and repositories" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Anonymous Auth, Audit Logging, Settings, and Authorization

**Files:**
- Create: `lib/auth/types.ts`
- Create: `lib/auth/anonymous-provider.ts`
- Create: `lib/auth/current-user.ts`
- Create: `lib/services/audit-service.ts`
- Create: `lib/services/settings-service.ts`
- Create: `lib/services/authorization-service.ts`
- Create: `app/api/settings/route.ts`
- Test: `tests/unit/anonymous-auth.test.ts`
- Test: `tests/unit/authorization-service.test.ts`
- Test: `tests/api/settings-route.test.ts`

**Interfaces:**
- Produces `AuthUser`.
- Produces `getCurrentUser(request: Request): Promise<AuthUser>`.
- Produces `AuthorizationService.assertUserOwnsResource(userId: string, ownerId: string): void`.
- Produces `AuditService.record(input: AuditEventInput): Promise<void>`.
- Produces `SettingsService.getForUser(userId: string): Promise<UserSettingsDto>`.

- [ ] **Step 1: Write failing auth tests**

Create `tests/unit/anonymous-auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createAnonymousFingerprintHash } from '@/lib/auth/anonymous-provider';

describe('anonymous auth provider', () => {
  it('creates a stable hash from a client fingerprint', async () => {
    const first = await createAnonymousFingerprintHash('browser-a');
    const second = await createAnonymousFingerprintHash('browser-a');
    expect(first).toBe(second);
    expect(first).not.toContain('browser-a');
  });
});
```

- [ ] **Step 2: Run failing auth tests**

Run:

```bash
pnpm vitest run tests/unit/anonymous-auth.test.ts
```

Expected: fail because auth files do not exist.

- [ ] **Step 3: Implement auth interfaces**

Create `lib/auth/types.ts`:

```ts
export type AuthProvider = 'anonymous';

export type AuthUser = {
  id: string;
  displayName: string;
  provider: AuthProvider;
};
```

Create `lib/auth/anonymous-provider.ts`:

```ts
import { createHash } from 'node:crypto';

export async function createAnonymousFingerprintHash(fingerprint: string): Promise<string> {
  return createHash('sha256').update(`localrag-nextjs:${fingerprint}`).digest('hex');
}
```

Create `lib/auth/current-user.ts`:

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/db/prisma';
import { createAnonymousFingerprintHash } from '@/lib/auth/anonymous-provider';
import type { AuthUser } from '@/lib/auth/types';
import { UserRepository } from '@/lib/repositories/user-repository';

const COOKIE_NAME = 'localrag_anonymous_id';

export async function getCurrentUser(): Promise<AuthUser> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  const fingerprint = existing ?? nanoid(32);
  if (!existing) {
    store.set(COOKIE_NAME, fingerprint, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  }

  const fingerprintHash = await createAnonymousFingerprintHash(fingerprint);
  const user = await new UserRepository(prisma).findOrCreateAnonymousUser(fingerprintHash);
  return { id: user.id, displayName: user.displayName, provider: 'anonymous' };
}
```

- [ ] **Step 4: Implement authorization and audit services**

Create `lib/services/authorization-service.ts`:

```ts
import { AppError } from '@/lib/http/api-errors';

export class AuthorizationService {
  assertUserOwnsResource(userId: string, ownerId: string): void {
    if (userId !== ownerId) {
      throw new AppError('FORBIDDEN', 'You do not have access to this resource.');
    }
  }
}
```

Create `lib/services/audit-service.ts` with `AuditEventInput` fields `userId`, `action`, `entityType`, `entityId`, `requestId`, `metadata`, `ipAddress`, `userAgent`; persist through `AuditRepository`.

- [ ] **Step 5: Implement settings service and route**

Create `lib/services/settings-service.ts` with defaults:

```ts
export type UserSettingsDto = {
  theme: 'system' | 'light' | 'dark';
  model: string;
  showReasoningMetadata: boolean;
};

export const defaultUserSettings: UserSettingsDto = {
  theme: 'system',
  model: 'gpt-4.1-mini',
  showReasoningMetadata: true,
};
```

Create `app/api/settings/route.ts` with `GET` and `PATCH`. Validate `PATCH` with Zod, call `getCurrentUser()`, write audit log on update, and return `{ data: settings }`.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm vitest run tests/unit/anonymous-auth.test.ts tests/unit/authorization-service.test.ts tests/api/settings-route.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/auth lib/services app/api/settings tests/unit tests/api
git commit -m "feat: add anonymous auth and settings" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: n8n Client, Execution Tracking, and Workflow Service Layer

**Files:**
- Create: `lib/n8n/types.ts`
- Create: `lib/n8n/errors.ts`
- Create: `lib/n8n/auth.ts`
- Create: `lib/n8n/client.ts`
- Create: `lib/n8n/workflow.ts`
- Create: `lib/n8n/executions.ts`
- Create: `lib/n8n/health.ts`
- Create: `lib/n8n/ingestion.ts`
- Create: `lib/n8n/retrieval.ts`
- Create: `lib/n8n/documents.ts`
- Test: `tests/unit/n8n-client.test.ts`
- Test: `tests/unit/n8n-executions.test.ts`

**Interfaces:**
- Produces `N8nClient.request<T>(input: N8nRequest<T>): Promise<T>`.
- Produces `N8nWorkflowService.startWorkflow(input): Promise<N8nWorkflowStartResult>`.
- Produces `N8nExecutionService.getExecution(executionId: string): Promise<N8nExecution>`.
- Produces `N8nIngestionService.startDocumentIngestion(input): Promise<N8nWorkflowStartResult>`.
- Produces `N8nRetrievalService.retrieve(input): Promise<RetrievedChunk[]>`.

- [ ] **Step 1: Write failing n8n client retry test**

Create `tests/unit/n8n-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { N8nClient } from '@/lib/n8n/client';

describe('N8nClient', () => {
  it('adds API key auth, request id, and retries transient failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 1,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.get('/api/v1/health', { requestId: 'req_123' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['X-N8N-API-KEY']).toBe('secret');
    expect(fetchMock.mock.calls[0][1].headers['x-request-id']).toBe('req_123');
  });
});
```

- [ ] **Step 2: Run failing n8n test**

Run:

```bash
pnpm vitest run tests/unit/n8n-client.test.ts
```

Expected: fail because `N8nClient` does not exist.

- [ ] **Step 3: Implement n8n types and errors**

Create `lib/n8n/types.ts`:

```ts
import { z } from 'zod';

export const n8nExecutionStatusSchema = z.enum(['new', 'running', 'success', 'error', 'canceled', 'crashed', 'waiting', 'unknown']);
export type N8nExecutionStatus = z.infer<typeof n8nExecutionStatusSchema>;

export const retrievedChunkSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  documentName: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  content: z.string().min(1),
  score: z.number(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type RetrievedChunk = z.infer<typeof retrievedChunkSchema>;
```

Create `lib/n8n/errors.ts`:

```ts
import { AppError } from '@/lib/http/api-errors';

export class N8nError extends AppError {
  constructor(message: string, details?: unknown) {
    super('UPSTREAM_ERROR', message, details);
    this.name = 'N8nError';
  }
}
```

- [ ] **Step 4: Implement `N8nClient`**

Create `lib/n8n/client.ts` with:

```ts
type FetchFn = typeof fetch;

export type N8nClientOptions = {
  baseUrl: string;
  apiKey: string;
  bearerToken?: string;
  timeoutMs: number;
  retryCount: number;
  retryDelayMs: number;
  fetchFn?: FetchFn;
};
```

Implement `get<T>()`, `post<T>()`, and private `request<T>()`. Use `AbortSignal.timeout`, `X-N8N-API-KEY`, optional `Authorization: Bearer`, JSON parsing, exponential backoff, retry only for `408`, `429`, and `5xx`, and throw `N8nError` with status/body details.

- [ ] **Step 5: Implement workflow services**

Create:

- `lib/n8n/workflow.ts`: list active workflows and start workflow entrypoints.
- `lib/n8n/executions.ts`: fetch execution with `includeData=true`, normalize status.
- `lib/n8n/health.ts`: call n8n health/workflow list safely.
- `lib/n8n/ingestion.ts`: `startDocumentIngestion({ documentId, uploadId, filePath, fileName, mimeType, requestId })`.
- `lib/n8n/retrieval.ts`: `retrieve({ query, conversationId, documentIds, topK, requestId })`.
- `lib/n8n/documents.ts`: shared document workflow DTOs.

Use Zod schema validation on every n8n response before returning domain objects.

- [ ] **Step 6: Verify**

Run:

```bash
pnpm vitest run tests/unit/n8n-client.test.ts tests/unit/n8n-executions.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add lib/n8n tests/unit/n8n-client.test.ts tests/unit/n8n-executions.test.ts
git commit -m "feat: add typed n8n service layer" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Uploads, Documents, Qdrant, Ingestion Services, and API Routes

**Files:**
- Create: `lib/qdrant/client.ts`
- Create: `lib/services/virus-scan-service.ts`
- Create: `lib/services/upload-validation-service.ts`
- Create: `lib/services/upload-service.ts`
- Create: `lib/services/document-service.ts`
- Create: `lib/services/workflow-service.ts`
- Create: `app/api/upload/route.ts`
- Create: `app/api/uploads/route.ts`
- Create: `app/api/documents/route.ts`
- Create: `app/api/documents/[id]/route.ts`
- Create: `app/api/workflows/route.ts`
- Create: `app/api/workflows/[id]/route.ts`
- Create: `scripts/seed-corpus.ts`
- Test: `tests/unit/upload-validation.test.ts`
- Test: `tests/integration/seed-corpus.test.ts`
- Test: `tests/api/upload-route.test.ts`
- Test: `tests/api/documents-route.test.ts`

**Interfaces:**
- Produces `UploadService.createUpload(input: CreateUploadInput): Promise<UploadResult>`.
- Produces `DocumentService.listDocuments(userId: string, query: DocumentQuery): Promise<DocumentListResult>`.
- Produces `WorkflowService.getWorkflowStatus(userId: string, workflowExecutionId: string): Promise<WorkflowExecutionDto>`.
- Produces `seedCorpus(): Promise<SeedCorpusResult>`.

- [ ] **Step 1: Write failing upload validation test**

Create `tests/unit/upload-validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { UploadValidationService } from '@/lib/services/upload-validation-service';

describe('UploadValidationService', () => {
  const service = new UploadValidationService({ maxBytes: 10_000_000 });

  it('accepts PDF files within size limits', async () => {
    const result = await service.validate({
      fileName: '1706.03762v7.pdf',
      mimeType: 'application/pdf',
      size: 1024,
    });

    expect(result.normalizedExtension).toBe('pdf');
  });

  it('rejects unsupported file types', async () => {
    await expect(
      service.validate({ fileName: 'malware.exe', mimeType: 'application/x-msdownload', size: 1024 }),
    ).rejects.toThrow('Unsupported file type');
  });
});
```

- [ ] **Step 2: Run failing upload validation test**

Run:

```bash
pnpm vitest run tests/unit/upload-validation.test.ts
```

Expected: fail because upload validation service does not exist.

- [ ] **Step 3: Implement upload validation and virus scan abstraction**

Create `lib/services/upload-validation-service.ts` with explicit allowed MIME/extension pairs for the product list. Enforce `maxBytes`, non-empty file names, normalized lower-case extension, and matching MIME. Throw `AppError('VALIDATION_ERROR', ...)` for validation failures.

Create `lib/services/virus-scan-service.ts`:

```ts
export type VirusScanResult = {
  clean: true;
  scanner: 'local-noop';
};

export class VirusScanService {
  async scanFile(filePath: string): Promise<VirusScanResult> {
    if (!filePath.startsWith('/')) {
      throw new Error('Virus scan requires an absolute file path.');
    }
    return { clean: true, scanner: 'local-noop' };
  }
}
```

The scan abstraction is intentionally safe and explicit: it does not claim external AV coverage, and it gives a stable seam for enterprise scanners.

- [ ] **Step 4: Implement upload/document/workflow services**

`UploadService.createUpload()` must:

1. Validate file metadata.
2. Write file bytes under `env.upload.tempDirectory`.
3. Scan the file.
4. Create `Upload` and `Document` records.
5. Create `WorkflowExecution`.
6. Call `N8nIngestionService.startDocumentIngestion()`.
7. Persist returned execution ID/status.
8. Record audit log.
9. Return typed DTO containing upload, document, and workflow IDs.

`DocumentService` must list, search, read, soft-delete, and request re-index for documents owned by the current user.

`WorkflowService` must map persisted workflow state and poll n8n when a workflow is running.

- [ ] **Step 5: Implement API routes**

Routes:

- `POST app/api/upload/route.ts`: multipart form upload, rate limit, same-origin check, current user, upload service.
- `GET app/api/uploads/route.ts`: upload history for current user.
- `GET app/api/documents/route.ts`: list/search/filter/sort documents.
- `GET app/api/documents/[id]/route.ts`: document metadata.
- `DELETE app/api/documents/[id]/route.ts`: soft-delete and audit.
- `GET app/api/workflows/route.ts`: list workflow executions.
- `GET app/api/workflows/[id]/route.ts`: single workflow status.

Each route returns `jsonOk()` or `jsonError()` and never returns internal n8n URLs or credentials.

- [ ] **Step 6: Implement corpus seeding**

Create `scripts/seed-corpus.ts`. It must:

1. Resolve both PDF paths from the repository root.
2. Compute SHA-256 hashes.
3. Create or reuse the anonymous local user.
4. Skip files already ingested with matching hash and `READY` status.
5. Call `UploadService.createUpload()` for missing files.
6. Poll associated workflow executions until success or configured timeout.
7. Exit non-zero on failed ingestion.

- [ ] **Step 7: Verify**

Run:

```bash
pnpm vitest run tests/unit/upload-validation.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add lib/qdrant lib/services app/api/upload app/api/uploads app/api/documents app/api/workflows scripts/seed-corpus.ts tests/unit/upload-validation.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts tests/integration/seed-corpus.test.ts
git commit -m "feat: add document upload and ingestion services" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: OpenAI Agents, Tools, Chat Service, and Streaming Chat Route

**Files:**
- Create: `lib/openai/message-converters.ts`
- Create: `lib/services/chat-service.ts`
- Create: `agents/general-assistant-agent.ts`
- Create: `agents/document-agent.ts`
- Create: `agents/retrieval-agent.ts`
- Create: `agents/registry.ts`
- Create: `agents/tools/retrieve-chunks.ts`
- Create: `agents/tools/list-documents.ts`
- Create: `agents/tools/workflow-status.ts`
- Create: `agents/tools/conversation-history.ts`
- Create: `agents/tools/search-conversation.ts`
- Create: `app/api/chat/route.ts`
- Create: `app/api/conversations/route.ts`
- Create: `app/api/conversations/[id]/route.ts`
- Create: `app/api/messages/route.ts`
- Create: `app/api/search/route.ts`
- Test: `tests/unit/message-converters.test.ts`
- Test: `tests/unit/agent-tools.test.ts`
- Test: `tests/api/chat-route.test.ts`

**Interfaces:**
- Produces `toAgentInput(messages: UIMessage[]): AgentInputItem[]`.
- Produces `ChatService.streamChat(input: StreamChatInput): Promise<Response>`.
- Produces `agentRegistry: Map<string, Agent>`.
- Produces typed tools returning serializable JSON domain data.

- [ ] **Step 1: Write failing converter test**

Create `tests/unit/message-converters.test.ts`:

```ts
import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { toAgentInput } from '@/lib/openai/message-converters';

describe('toAgentInput', () => {
  it('converts UI text parts into agent input', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'What is the cargo capacity of Cymbal Starlight?' }],
      },
    ];

    const input = toAgentInput(messages);
    expect(input).toHaveLength(1);
    expect(JSON.stringify(input)).toContain('Cymbal Starlight');
  });
});
```

- [ ] **Step 2: Run failing converter test**

Run:

```bash
pnpm vitest run tests/unit/message-converters.test.ts
```

Expected: fail because converter does not exist.

- [ ] **Step 3: Implement message converters**

Implement `lib/openai/message-converters.ts` based on the OpenAI AI SDK UI reference. Support `system`, `user`, and `assistant` roles. Extract text from `parts` first and from legacy `content` only when present. Drop empty text messages.

- [ ] **Step 4: Implement foundation tools**

Each tool uses `tool()` from `@openai/agents` and Zod parameters.

Required tool names:

- `retrieve_chunks`
- `list_documents`
- `workflow_status`
- `conversation_history`
- `search_conversation`

`retrieve_chunks` returns:

```ts
export type RetrieveChunksToolResult = {
  chunks: Array<{
    id: string;
    documentId: string;
    documentName: string;
    chunkIndex: number;
    content: string;
    score: number;
  }>;
};
```

Record each tool call through `ToolCall` repository with status, duration, input, output, and error message.

- [ ] **Step 5: Implement agents and registry**

`GeneralAssistantAgent` instructions:

```text
You are an enterprise document assistant. Answer conversationally and concisely. When a question may depend on uploaded documents, call retrieve_chunks before answering. Cite retrieved chunks inline using the citation metadata returned by tools. Never mention n8n, Qdrant, internal workflow IDs, credentials, or hidden service details to the user.
```

`DocumentAgent` focuses on document-grounded answers. `RetrievalAgent` focuses on retrieval planning. Register all three in `agents/registry.ts`, defaulting to `GeneralAssistantAgent`.

- [ ] **Step 6: Implement chat service and route**

`ChatService.streamChat()` must:

1. Validate conversation ownership.
2. Create conversation if one is not supplied.
3. Persist the latest user message.
4. Create `AgentRun`.
5. Run the active agent with `{ stream: true, conversationId }`.
6. Return `createAiSdkUiMessageStreamResponse(stream)`.
7. Persist active agent and run completion status when `stream.completed` resolves.
8. Persist failures and return structured errors without leaking secrets.

`app/api/chat/route.ts` must parse body with Zod:

```ts
const chatRequestSchema = z.object({
  id: z.string().optional(),
  conversationId: z.string().optional(),
  messages: z.array(z.custom<UIMessage>()),
  activeAgentName: z.string().optional(),
});
```

- [ ] **Step 7: Implement conversation/message/search routes**

Routes:

- `GET/POST app/api/conversations/route.ts`
- `GET/PATCH/DELETE app/api/conversations/[id]/route.ts`
- `GET app/api/messages/route.ts`
- `GET app/api/search/route.ts`

All routes use current user ownership and repository/service access.

- [ ] **Step 8: Verify**

Run:

```bash
pnpm vitest run tests/unit/message-converters.test.ts tests/unit/agent-tools.test.ts tests/api/chat-route.test.ts
pnpm typecheck
```

Expected: pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add lib/openai lib/services/chat-service.ts agents app/api/chat app/api/conversations app/api/messages app/api/search tests/unit/message-converters.test.ts tests/unit/agent-tools.test.ts tests/api/chat-route.test.ts
git commit -m "feat: add agents and streaming chat route" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: React Query Provider, Shell Layout, Sidebar, Chat UI, Upload UI, Documents UI, Settings UI

**Files:**
- Create: `components/providers/query-provider.tsx`
- Create: `components/providers/theme-provider.tsx`
- Create: `components/common/app-shell.tsx`
- Create: `components/common/status-badge.tsx`
- Create: `components/sidebar/sidebar.tsx`
- Create: `components/sidebar/conversation-list.tsx`
- Create: `components/chat/chat-view.tsx`
- Create: `components/chat/message-list.tsx`
- Create: `components/chat/message-composer.tsx`
- Create: `components/chat/markdown-message.tsx`
- Create: `components/upload/upload-dropzone.tsx`
- Create: `components/documents/document-library.tsx`
- Create: `components/settings/settings-panel.tsx`
- Create: `hooks/use-conversations.ts`
- Create: `hooks/use-documents.ts`
- Create: `hooks/use-health.ts`
- Create: `hooks/use-upload-queue.ts`
- Modify: `app/layout.tsx`
- Modify: `app/page.tsx`
- Test: `tests/components/chat-view.test.tsx`
- Test: `tests/components/sidebar.test.tsx`
- Test: `tests/components/upload-dropzone.test.tsx`

**Interfaces:**
- Produces `AppShell`.
- Produces `ChatView` using `useChat()` from `@ai-sdk/react`.
- Produces TanStack Query hooks for conversations, documents, health, and uploads.
- Later E2E tests consume stable labels: `New Chat`, `Knowledge Base`, `Settings`, `System Status`, `Send message`, `Stop generation`, `Retry response`.

- [ ] **Step 1: Write failing chat component test**

Create `tests/components/chat-view.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatView } from '@/components/chat/chat-view';

describe('ChatView', () => {
  it('renders the message composer and core chat actions', () => {
    render(<ChatView initialConversationId={null} />);
    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry response' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing component test**

Run:

```bash
pnpm vitest run tests/components/chat-view.test.tsx
```

Expected: fail because components do not exist.

- [ ] **Step 3: Implement providers and shell**

Wrap `app/layout.tsx` with theme and query providers. `AppShell` renders responsive sidebar, main chat region, and panels for Knowledge Base, Settings, and System Status. Use semantic landmarks and keyboard-accessible buttons.

- [ ] **Step 4: Implement chat components**

`ChatView` uses:

```ts
const { messages, sendMessage, regenerate, stop, status, error, clearError } = useChat({
  api: '/api/chat',
  body: { conversationId: activeConversationId },
});
```

Render:

- streaming status
- timestamps
- model badge
- agent badge
- markdown/GFM
- code blocks
- tables
- Mermaid/math containers
- citations
- collapsible metadata
- copy, retry, stop actions
- autoscroll with user override

- [ ] **Step 5: Implement sidebar, upload, documents, settings**

Sidebar supports:

- New Chat
- conversation list/search/rename/delete
- Knowledge Base
- Settings
- User Menu
- System Status

Upload supports:

- drag and drop
- browse
- multiple uploads
- progress
- cancel
- retry
- status and validation errors

Document library supports:

- search
- filter
- sort
- delete
- metadata
- chunk count
- embedding status
- workflow status
- upload history
- re-index action

- [ ] **Step 6: Verify**

Run:

```bash
pnpm vitest run tests/components/chat-view.test.tsx tests/components/sidebar.test.tsx tests/components/upload-dropzone.test.tsx
pnpm typecheck
pnpm lint
```

Expected: pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add components hooks app/layout.tsx app/page.tsx tests/components
git commit -m "feat: add enterprise chat application shell" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Health Checks, System Status, and Operational Readiness

**Files:**
- Create: `lib/services/health-service.ts`
- Create: `app/api/health/route.ts`
- Create: `components/common/system-status.tsx`
- Test: `tests/unit/health-service.test.ts`
- Test: `tests/api/health-route.test.ts`
- Test: `tests/components/system-status.test.tsx`

**Interfaces:**
- Produces `HealthService.getHealth(): Promise<SystemHealthDto>`.
- Produces `SystemHealthDto` with checks for `app`, `database`, `n8n`, `qdrant`, and `openai`.

- [ ] **Step 1: Write failing health service test**

Create `tests/unit/health-service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from '@/lib/services/health-service';

describe('HealthService', () => {
  it('reports component health without secret values', async () => {
    const service = new HealthService({
      database: { ping: vi.fn().mockResolvedValue(true) },
      n8n: { ping: vi.fn().mockResolvedValue(true) },
      qdrant: { ping: vi.fn().mockResolvedValue(true) },
      openai: { configured: vi.fn().mockReturnValue(true) },
    });

    const health = await service.getHealth();
    expect(health.status).toBe('healthy');
    expect(JSON.stringify(health)).not.toContain('sk-');
    expect(health.checks.map((check) => check.name)).toEqual(['app', 'database', 'n8n', 'qdrant', 'openai']);
  });
});
```

- [ ] **Step 2: Implement health service and route**

`HealthService` checks:

- app uptime/version
- Prisma database query
- n8n health/workflow list
- Qdrant collection availability
- OpenAI API key/model configured

Return only statuses, durations, and safe messages. `app/api/health/route.ts` returns HTTP `200` for healthy/degraded and `503` for unhealthy.

- [ ] **Step 3: Implement system status UI**

`SystemStatus` consumes `/api/health` through `useHealth()`, displays badges, last checked time, and degraded/unhealthy details without secrets.

- [ ] **Step 4: Verify**

Run:

```bash
pnpm vitest run tests/unit/health-service.test.ts tests/api/health-route.test.ts tests/components/system-status.test.tsx
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add lib/services/health-service.ts app/api/health components/common/system-status.tsx tests/unit/health-service.test.ts tests/api/health-route.test.ts tests/components/system-status.test.tsx
git commit -m "feat: add health checks and system status" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Docker Compose, n8n Workflow Assets, and Local Service Wiring

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `docker/n8n/workflows/ingestion.json`
- Create: `docker/n8n/workflows/retrieval.json`
- Create: `docker/n8n/README.md`
- Test: `tests/unit/docker-compose.test.ts`

**Interfaces:**
- Produces `docker compose up` stack with services `nextjs`, `postgres`, `n8n`, `qdrant`, and `redis`.
- Produces n8n workflow import assets named `ingestion` and `retrieval`.

- [ ] **Step 1: Write failing Docker Compose test**

Create `tests/unit/docker-compose.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('docker compose', () => {
  const compose = readFileSync('docker-compose.yml', 'utf8');

  it.each(['nextjs', 'postgres', 'n8n', 'qdrant', 'redis'])('defines service %s', (serviceName) => {
    expect(compose).toContain(`${serviceName}:`);
  });

  it('uses internal service names for application dependencies', () => {
    expect(compose).toContain('N8N_BASE_URL=http://n8n:5678');
    expect(compose).toContain('QDRANT_URL=http://qdrant:6333');
  });
});
```

- [ ] **Step 2: Implement Dockerfile**

Use a multi-stage Node image with pnpm enabled through corepack. Build with `pnpm install --frozen-lockfile`, `pnpm prisma generate`, and `pnpm build`. Run as non-root user and expose port `3000`.

- [ ] **Step 3: Implement Docker Compose**

`docker-compose.yml` must:

- define a private network
- run Postgres 16 with healthcheck
- run Qdrant with persistent volume and healthcheck
- run n8n with Postgres-backed storage, imported workflows, diagnostics disabled, and no browser-facing application dependency
- run optional Redis
- run Next.js with internal environment variables
- mount source for hot reload in development profile or document production-mode use clearly

- [ ] **Step 4: Add n8n workflow assets**

`ingestion.json` must encode a workflow that accepts an internal service request, extracts PDF text, chunks content, generates embeddings, writes vectors to Qdrant, and returns document/chunk metadata.

`retrieval.json` must encode a workflow that accepts query/document constraints, embeds query text, retrieves ranked Qdrant chunks, and returns the normalized chunk shape expected by `retrievedChunkSchema`.

Use OpenAI embedding credentials in n8n through environment-backed credentials. Do not expose workflow URLs in client code.

- [ ] **Step 5: Verify Compose config**

Run:

```bash
pnpm vitest run tests/unit/docker-compose.test.ts
docker compose config --quiet
```

Expected: test passes and Docker Compose config is valid.

- [ ] **Step 6: Commit**

Run:

```bash
git add Dockerfile docker-compose.yml .dockerignore docker/n8n tests/unit/docker-compose.test.ts
git commit -m "feat: add dockerized n8n qdrant stack" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Integration and End-to-End Corpus Validation

**Files:**
- Create: `tests/fixtures/corpus-questions.ts`
- Create: `tests/integration/rag-retrieval.test.ts`
- Create: `tests/e2e/app-shell.spec.ts`
- Create: `tests/e2e/corpus-rag.spec.ts`
- Create: `tests/e2e/upload-documents.spec.ts`
- Create: `tests/e2e/conversations.spec.ts`

**Interfaces:**
- Produces shared corpus fixtures for both Vitest and Playwright.
- Produces E2E tests proving seeded PDF ingestion and streaming answers with citations.

- [ ] **Step 1: Create corpus fixtures**

Create `tests/fixtures/corpus-questions.ts`:

```ts
export const corpusQuestions = [
  {
    fileName: '1706.03762v7.pdf',
    question:
      'What specific hardware setup and optimizer were used to train the base and big Transformer models? Additionally, how long did the training take for each model, and what were their final BLEU scores on the WMT 2014 English-to-German dataset?',
    requiredAnswerFragments: ['P100', 'Adam', 'BLEU'],
  },
  {
    fileName: 'cymbal-starlight-2024.pdf',
    question: 'What is the cargo capacity of Cymbal Starlight?',
    requiredAnswerFragments: ['cargo'],
  },
] as const;
```

- [ ] **Step 2: Implement integration retrieval test**

`tests/integration/rag-retrieval.test.ts` must:

1. Ensure corpus seeding has run.
2. Call `RetrievalService.retrieve()` for each question.
3. Assert at least one chunk is returned.
4. Assert returned chunks include the expected document name.
5. Assert scores are numeric and content is non-empty.

- [ ] **Step 3: Implement Playwright app shell test**

`tests/e2e/app-shell.spec.ts` must verify:

- page loads
- sidebar actions visible
- theme toggle works
- Knowledge Base, Settings, and System Status panels open

- [ ] **Step 4: Implement Playwright corpus RAG test**

`tests/e2e/corpus-rag.spec.ts` must:

1. Start from a clean conversation.
2. Ask each corpus question.
3. Wait for streaming to finish.
4. Assert required fragments appear.
5. Assert at least one citation is visible.
6. Assert conversation persists after reload.

- [ ] **Step 5: Verify E2E stack**

Run:

```bash
docker compose up -d postgres qdrant n8n
pnpm prisma migrate deploy
pnpm seed:corpus
pnpm test:integration
pnpm test:e2e
```

Expected: integration and Playwright tests pass. If external OpenAI calls are disabled in CI, run these tests in a documented local profile with required env vars.

- [ ] **Step 6: Commit**

Run:

```bash
git add tests/fixtures tests/integration/rag-retrieval.test.ts tests/e2e
git commit -m "test: add corpus rag validation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 12: README, Production Checklist, and Final Verification

**Files:**
- Create: `README.md`
- Create: `LICENSE`
- Create: `docs/operations/local-development.md`
- Create: `docs/operations/security.md`
- Create: `docs/operations/testing.md`

**Interfaces:**
- Produces user-facing setup and validation docs.
- Documents advanced product surface as planned enhancements without shipping inactive code.

- [ ] **Step 1: Write README**

`README.md` must include these exact section headings:

```markdown
## Executive Summary & Business Impact
## Tech Stack
## Architectural References
## Architecture
## Local Development
## Docker Compose
## Environment Configuration
## Seeded PDF Corpus
## RAG Validation Questions
## Security Model
## n8n Internal Service Model
## Testing
## Future Enhancements
```

The architectural references section must link to:

- <https://github.com/openai/openai-agents-js/tree/main/examples/ai-sdk-ui>
- <https://github.com/otyeung/localRAG>

- [ ] **Step 2: Document operations**

Create:

- `docs/operations/local-development.md`: pnpm install, env setup, Docker Compose startup, Prisma migration, seeding, dev server.
- `docs/operations/security.md`: server-only secrets, CSP, CSRF, rate limiting, upload validation, virus scan seam, audit logging, n8n isolation.
- `docs/operations/testing.md`: unit, integration, Playwright, corpus validation, Docker validation.

- [ ] **Step 3: Add Apache License 2.0**

Create `LICENSE` using the canonical Apache License 2.0 text with the copyright line:

```text
Copyright 2026 localRAG-nextJS contributors
```

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
docker compose config --quiet
pnpm test:e2e
```

Expected: all pass.

- [ ] **Step 5: Verify Docker startup**

Run:

```bash
docker compose up -d
docker compose ps
```

Expected: `nextjs`, `postgres`, `n8n`, and `qdrant` are healthy or running; `redis` is running when enabled.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md LICENSE docs/operations
git commit -m "docs: add enterprise rag app operations guide" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

- [ ] **Step 7: Final acceptance check**

Run:

```bash
git status --short
```

Expected: clean working tree. If generated artifacts such as logs or temp uploads appear, remove them or add safe ignore rules before final handoff.

---

### Task 13: Public GitHub Repository, Push, and Local Dev Server Handoff

**Files:**
- Modify: `.gitignore`
- Verify: `LICENSE`
- Verify: all committed source, docs, tests, Docker, and Prisma files

**Interfaces:**
- Produces public GitHub repository `localRAG-nextJS`.
- Produces configured `origin` remote.
- Produces a pushed and merged default branch.
- Cleans up safe feature branch/worktree state.
- Produces a running local development server for user testing.

- [ ] **Step 1: Verify `.gitignore` excludes generated and secret files**

Ensure `.gitignore` includes:

```gitignore
.env
.env.*
!.env.example
.next/
node_modules/
coverage/
test-results/
playwright-report/
uploads/
tmp/
*.log
```

Run:

```bash
git check-ignore .env .next/cache node_modules/.pnpm >/dev/null
```

Expected: command exits successfully because generated and secret paths are ignored.

- [ ] **Step 2: Verify Apache License 2.0 file**

Run:

```bash
grep -q "Apache License" LICENSE
grep -q "Version 2.0" LICENSE
```

Expected: both commands pass.

- [ ] **Step 3: Commit any remaining implementation changes**

Run:

```bash
git status --short
git add .
git diff --cached --quiet || git commit -m "chore: finalize localRAG nextjs app" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Expected: all intentional files are committed. No secrets from `.env` or local generated artifacts are staged.

- [ ] **Step 4: Create or connect the public GitHub repository**

Run:

```bash
gh repo view localRAG-nextJS >/dev/null 2>&1 || gh repo create localRAG-nextJS --public --description "Production-grade Next.js RAG app with OpenAI Agents SDK, AI SDK UI, n8n, Prisma, Postgres, and Qdrant"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$(gh repo view localRAG-nextJS --json sshUrl --jq .sshUrl)"
```

Expected: a public GitHub repository named `localRAG-nextJS` exists and `origin` points to it.

- [ ] **Step 5: Push the default branch**

Run:

```bash
CURRENT_BRANCH="$(git branch --show-current)"
git push -u origin "$CURRENT_BRANCH"
```

Expected: branch is pushed to GitHub successfully.

- [ ] **Step 6: Merge into the default branch and push**

Run:

```bash
CURRENT_BRANCH="$(git branch --show-current)"
git switch main
git merge --no-ff "$CURRENT_BRANCH" -m "merge: enterprise rag foundation"
git push -u origin main
```

Expected: the completed implementation is merged into `main` and pushed to GitHub.

- [ ] **Step 7: Clean up safe worktree and feature branch state**

If implementation used a linked worktree, remove only that completed linked worktree after confirming no uncommitted work remains:

```bash
git worktree list
git worktree remove <completed-worktree-path>
```

If implementation ran in the primary checkout, do not remove the current directory. After the merge is pushed and no uncommitted work remains, remove the merged local feature branch only when not currently checked out:

```bash
git branch --merged main
git branch -d "$CURRENT_BRANCH"
```

Expected: no completed linked worktree remains. The primary checkout stays intact for local testing.

- [ ] **Step 8: Start the local development server for user testing**

Run:

```bash
pnpm dev
```

Expected: Next.js dev server starts and reports a local URL, normally `http://localhost:3000`. Keep the process running so the user can test.
