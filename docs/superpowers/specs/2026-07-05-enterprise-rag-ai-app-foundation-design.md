# Enterprise RAG AI App Foundation Design

Date: 2026-07-05

## Executive Summary

Build a production-grade foundation slice for a single-repository AI application that combines Next.js 15, React 19, OpenAI Agents SDK, Vercel AI SDK UI, OpenAI Responses API, n8n, Prisma, PostgreSQL, Qdrant, Docker, pnpm, Tailwind CSS, and shadcn/ui.

The first implementation intentionally delivers a complete vertical slice rather than every future feature at once. It must be deployable, typed, tested, observable, secure, and useful end-to-end: a user can run the stack locally, seed the two provided PDFs through the real ingestion workflow, ask the provided corpus questions in a ChatGPT-quality interface, receive streamed grounded answers with citations, and inspect document/workflow health without the browser ever communicating directly with n8n.

## Project Context

The current directory contains only the sample corpus files:

- `1706.03762v7.pdf`
- `cymbal-starlight-2024.pdf`

There is no existing Next.js application and the directory is not currently a Git repository. The design therefore assumes a new single Next.js application will be created in this directory.

The architecture references:

- Frontend and streaming pattern: <https://github.com/openai/openai-agents-js/tree/main/examples/ai-sdk-ui>
- RAG workflow pattern: <https://github.com/otyeung/localRAG>

The OpenAI reference demonstrates `@openai/agents`, agent handoffs/tools, conversion between AI SDK UI messages and agent input, and `createAiSdkUiMessageStreamResponse()` for streaming an Agents SDK run into AI SDK UI. The localRAG reference demonstrates an n8n-driven RAG workflow using document loading, recursive splitting, embeddings, and Qdrant retrieval. This app adapts both into one enterprise Next.js repository.

## Selected Approach

Use a production vertical slice.

The first slice includes:

- Single Next.js 15 App Router application.
- React 19, TypeScript, Tailwind CSS, shadcn/ui, React Hook Form, Zod, TanStack Query, Pino, Prisma, PostgreSQL, Qdrant, n8n, Docker Compose, pnpm, Vitest, Playwright, ESLint, and Prettier.
- Anonymous local user/session abstraction designed for future migration to NextAuth, OAuth, OpenAI Auth, Google, GitHub, or Azure AD.
- Core ChatGPT-style responsive shell with sidebar, chat, knowledge base, settings, user menu, and system status.
- OpenAI Agents SDK streaming chat through Vercel AI SDK UI.
- n8n service layer hidden behind Next.js services.
- Seeded ingestion for both sample PDFs through the real ingestion path.
- End-to-end validation using the provided corpus questions.

The first slice does not implement every advanced dashboard, inspector, export/import flow, or every specialized agent/tool from the long-term product vision. Those are documented as future enhancements and must not be represented by placeholders or half-implemented stubs.

## Architecture

The browser communicates only with Next.js routes.

```text
Browser
  |
  v
Next.js App Router
  |
  v
Next.js API Routes
  |
  v
Application Services
  |------> Prisma/PostgreSQL
  |------> OpenAI Agents SDK
  |------> OpenAI Responses API
  |------> n8n Service Layer
              |
              v
           n8n REST API
              |
              v
        Internal Workflows
              |
        Qdrant Vector Store
```

Next.js owns:

- Authentication boundary.
- Upload validation and temporary storage.
- Streaming chat.
- Conversation/message persistence.
- Agent orchestration.
- Tool execution records.
- Business rules.
- API validation.
- Security controls.
- Audit logs.
- Database state.

n8n owns:

- Document extraction.
- Chunking.
- Embedding workflow execution.
- Vector insertion.
- Retrieval workflow execution.
- Vector processing.

Qdrant stores vector embeddings and vector payload metadata. PostgreSQL remains the durable application system of record through Prisma.

## n8n Service Layer

Create a typed service layer under `lib/n8n/`:

```text
lib/n8n/
  auth.ts
  client.ts
  documents.ts
  errors.ts
  executions.ts
  health.ts
  ingestion.ts
  retrieval.ts
  types.ts
  workflow.ts
```

Responsibilities:

- API key authentication using `X-N8N-API-KEY`.
- Bearer authentication support when configured.
- Configurable internal base URL.
- Strict request and response validation with Zod.
- Pino structured logging.
- Request correlation IDs.
- Timeouts.
- Automatic retries with exponential backoff.
- Circuit breaker behavior.
- Health checks.
- Workflow status polling.
- Execution result retrieval.
- Domain-object transformation.

n8n is only reachable on the internal Docker network. The browser never receives n8n URLs, credentials, execution payloads, or workflow internals.

Workflow invocations are modeled as internal service-to-service operations. If an n8n trigger endpoint is required for a workflow entry point, it must be private to the Docker network and invoked only by the Next.js n8n service layer; it must not be public, linked from the client, or treated as the application API.

## Document Ingestion

Upload flow:

1. Browser submits files to `app/api/upload`.
2. Next.js validates MIME type, extension, size, count, and user authorization.
3. Next.js writes files to configured temporary storage.
4. Next.js creates `Upload`, `Document`, and `WorkflowExecution` records.
5. `IngestionService` calls `lib/n8n/ingestion.ts`.
6. n8n extracts text, chunks content, generates OpenAI embeddings, and writes vectors to Qdrant.
7. n8n returns normalized metadata.
8. Next.js validates the response, persists chunk and embedding metadata, updates upload/document/workflow status, and emits UI cache invalidations.

Supported file types in the product architecture:

- PDF
- DOCX
- TXT
- Markdown
- CSV
- Excel
- PowerPoint
- JSON
- HTML
- PNG
- JPEG
- ZIP

The foundation slice must fully support the two provided PDF files. Other supported types may be included only when implemented end-to-end with validation, extraction behavior, tests, and error handling.

Local/dev seeding:

- Keep the two PDFs in the repository.
- Seed them through the same ingestion service used by normal uploads.
- Record seeded uploads under the anonymous local user.
- Make seeding idempotent by file hash.
- Use the seeded corpus for integration and Playwright tests.

## Retrieval and RAG

Retrieval flow:

1. Browser sends chat input through AI SDK UI `useChat()`.
2. `app/api/chat` validates the request and resolves the anonymous user/session.
3. The active OpenAI Agent receives the latest user message and conversation context.
4. The agent decides whether retrieval is needed.
5. The `retrieveChunks()` tool calls `RetrievalService`.
6. `RetrievalService` calls `lib/n8n/retrieval.ts`.
7. n8n retrieves ranked chunks from Qdrant.
8. Next.js validates returned chunks, records the tool call, and provides grounded context to the agent.
9. The OpenAI Responses API and Agents SDK stream the final answer back through AI SDK UI.
10. Next.js persists assistant messages, citations, agent run metadata, and tool call metadata.

Required validation questions:

| Corpus | Test question |
| --- | --- |
| `1706.03762v7.pdf` | What specific hardware setup and optimizer were used to train the base and big Transformer models? Additionally, how long did the training take for each model, and what were their final BLEU scores on the WMT 2014 English-to-German dataset? |
| `cymbal-starlight-2024.pdf` | What is the cargo capacity of Cymbal Starlight? |

Tests must verify that answers are grounded in retrieved chunks and include citations to the relevant document metadata.

## Agents and Tools

Foundation agents:

- `GeneralAssistantAgent`: default chat entry point, routes to document retrieval when needed.
- `DocumentAgent`: handles document-aware questions and citation behavior.
- `RetrievalAgent`: specializes in retrieval planning and chunk interpretation.

Designed for later slices:

- `SummarizationAgent`
- `ExtractionAgent`
- `SearchAgent`

Foundation tools:

- `retrieveChunks()`
- `listDocuments()`
- `workflowStatus()`
- `conversationHistory()`
- `searchConversation()`

Designed for later slices:

- `searchKnowledgeBase()`
- `uploadDocument()`
- `deleteDocument()`
- `summarizeDocument()`
- `extractEntities()`

Later tools must not appear as inert placeholders in the foundation slice. They should be documented as planned capabilities until implemented across backend, frontend, database, API, validation, tests, logging, and error handling.

## Chat and UI

The UI should feel comparable to ChatGPT while staying focused on the foundation slice.

In scope:

- Responsive layout for desktop, tablet, and mobile.
- Dark and light mode.
- Left sidebar with New Chat, conversation list, conversation search, rename, delete, Knowledge Base, Settings, User Menu, and System Status.
- Main chat surface with streaming responses.
- Markdown and GitHub Flavored Markdown.
- Syntax-highlighted code blocks.
- Tables.
- Mermaid and math rendering with safe rendering controls.
- Copy response.
- Retry/regenerate response.
- Stop generation.
- Typing indicator.
- Auto-scroll.
- Message timestamps.
- Model badge.
- Agent badge.
- Streaming tool execution status.
- Inline citations.
- Collapsible reasoning/tool metadata when available.
- Clear loading and error states.
- Keyboard-accessible controls.

Out of scope for the first slice but documented in README future enhancements:

- Full right inspector.
- Conversation export/import.
- Advanced workflow dashboard.
- Advanced execution dashboard.
- Advanced upload dashboard.
- Admin-grade settings console.
- Rich document preview for every file type.

## API Routes

Create these route groups:

```text
app/api/chat
app/api/upload
app/api/documents
app/api/conversations
app/api/messages
app/api/search
app/api/settings
app/api/health
app/api/workflows
app/api/uploads
```

Route requirements:

- Zod request validation.
- Zod response validation where responses cross service boundaries.
- Typed service calls.
- Authorization checks.
- Structured error responses.
- Pino request logging.
- Request IDs.
- Audit logging for sensitive actions.
- No direct database access from route handlers except through repositories/services.

## Database Design

Use Prisma with PostgreSQL.

Models:

- `User`
- `Conversation`
- `Message`
- `Attachment`
- `Document`
- `ChunkMetadata`
- `EmbeddingMetadata`
- `WorkflowExecution`
- `Upload`
- `AgentRun`
- `ToolCall`
- `AuditLog`
- `Settings`

Key relationships:

- A `User` has many conversations, uploads, documents, settings, and audit logs.
- A `Conversation` has many messages and agent runs.
- A `Message` may have attachments, citations, tool call references, and metadata.
- A `Document` belongs to a user and has upload, chunk, embedding, and workflow metadata.
- A `WorkflowExecution` may be associated with an upload, document, and user.
- An `AgentRun` belongs to a conversation and may have many `ToolCall` records.

Repositories isolate Prisma access. Services own business workflows. Route handlers remain thin.

## State Management

Use TanStack Query for:

- Conversation cache.
- Conversation search.
- Knowledge base cache.
- Upload queue state.
- Workflow polling.
- Settings cache.
- Health/system status cache.

Use AI SDK UI state for active streaming messages. Persist authoritative conversation state in Postgres after each completed or failed run. Use optimistic UI only where rollback behavior is explicit.

## Security

Security requirements:

- OpenAI API keys never reach the browser.
- n8n credentials never reach the browser.
- Database credentials never reach the browser.
- Server-only environment access.
- Rate limiting on chat, upload, search, and workflow retry routes.
- CSRF protection for cookie-backed mutation flows.
- Content Security Policy headers.
- MIME type and extension validation.
- Configurable upload limits.
- Temporary upload isolation.
- Virus scan abstraction before ingestion.
- Input sanitization.
- Safe markdown rendering and output encoding.
- Authorization checks on conversations, documents, uploads, workflow executions, messages, and settings.
- Audit logs for uploads, deletes, settings changes, workflow retries, and agent/tool runs.

Authentication begins with an anonymous local user provider. The interface must support future migration to NextAuth, OAuth, OpenAI Auth, Google, GitHub, or Azure AD without rewriting services.

## Configuration

Create `.env.example` with at least:

```text
OPENAI_API_KEY=
OPENAI_MODEL=
DATABASE_URL=
N8N_BASE_URL=
N8N_API_KEY=
N8N_TIMEOUT=
N8N_RETRY_COUNT=
N8N_RETRY_DELAY=
LOG_LEVEL=
MAX_UPLOAD_SIZE=
TEMP_UPLOAD_DIRECTORY=
```

Because Qdrant is selected, also include Qdrant configuration such as internal URL, collection name, vector size, and distance metric. Postgres, n8n, and Docker-specific variables should be present without exposing real secrets.

## Docker

Docker Compose services:

- `nextjs`
- `postgres`
- `n8n`
- `qdrant`
- `redis` as optional caching/queue infrastructure

The stack must start with:

```bash
docker compose up
```

Development must support hot reload. Service names should resolve over the internal Docker network. n8n and Qdrant should not be exposed as public application APIs.

## Logging and Observability

Use Pino:

- Pretty logs in development.
- JSON logs in production.
- Request IDs.
- Workflow IDs.
- Execution IDs.
- Agent run IDs.
- Tool call IDs.
- Trace IDs.

Health endpoints must report readiness for:

- Next.js application.
- PostgreSQL.
- n8n.
- Qdrant.
- OpenAI configuration.

Health responses must not leak secrets.

## Testing Strategy

Use Vitest for:

- Utility tests.
- Zod schema tests.
- Repository tests.
- Service tests.
- n8n client retry/timeout/circuit breaker tests.
- Agent and tool tests.
- API route validation tests.
- Workflow polling tests.

Use component tests for:

- Chat message rendering.
- Sidebar states.
- Upload queue states.
- Document library states.
- Settings and health states.

Use Playwright for:

- Initial app load.
- Seeded corpus ingestion status.
- Chat streaming.
- Stop generation.
- Retry/regenerate.
- Conversation persistence.
- Conversation search.
- Document search.
- The two required RAG test questions.

Completion gates:

- `pnpm build`
- TypeScript type checking.
- ESLint.
- Unit tests.
- Integration tests.
- Playwright tests.
- Docker Compose local startup.

## README Requirements

Generate `README.md` during implementation with:

- `Executive Summary & Business Impact`
- `Tech Stack`
- Reference links to:
  - <https://github.com/openai/openai-agents-js/tree/main/examples/ai-sdk-ui>
  - <https://github.com/otyeung/localRAG>
- Architecture overview.
- Local setup.
- Docker Compose startup.
- Environment configuration.
- Seeded PDF corpus instructions.
- Test questions and expected validation purpose.
- Security model.
- n8n internal-service model.
- Future enhancements capturing the full advanced UI/dashboard/product surface from the original request.

## Future Enhancements

Later specs should cover:

- Full document type support beyond the seeded PDFs.
- Full right inspector.
- Conversation export/import.
- Advanced knowledge base preview and metadata views.
- Advanced workflow dashboard.
- Execution dashboard.
- Upload dashboard.
- Summarization agent.
- Extraction agent.
- Search agent.
- `searchKnowledgeBase()`.
- `uploadDocument()` as an agent tool.
- `deleteDocument()` as an agent tool with explicit authorization.
- `summarizeDocument()`.
- `extractEntities()`.
- Admin settings and enterprise identity providers.
- Production queue workers if ingestion volume requires separation from route handlers.

## Acceptance Criteria

The foundation slice is complete when:

1. The app runs as a single Next.js repository.
2. `docker compose up` starts Next.js, Postgres, n8n, Qdrant, and optional Redis configuration.
3. The browser only communicates with Next.js.
4. n8n is accessible only through the Next.js service layer.
5. The two sample PDFs are seeded through the real ingestion workflow.
6. The app can answer both required corpus questions through streaming chat with citations.
7. Conversations, messages, documents, chunks, embeddings, uploads, workflow executions, agent runs, tool calls, audit logs, and settings persist in Postgres.
8. Qdrant stores and retrieves document vectors.
9. API routes are typed, validated, logged, authorized, and tested.
10. The UI is responsive, accessible, polished, and supports the approved foundation chat/document/sidebar/settings/status flows.
11. Secrets are server-only and never exposed to the browser.
12. README includes the required sections and reference links.
13. The implementation passes build, type checking, linting, unit tests, integration tests, Playwright tests, and Docker local startup validation.

