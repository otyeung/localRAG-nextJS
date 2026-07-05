# Task 7 Report

## Scope
Implemented Task 7 only: OpenAI Agents SDK agents/tools, message conversion, chat service, streaming chat route, and conversation/message/search routes. No Task 8 UI, Docker, E2E, or docs work was added.

## Requirements Readback
- Added `toAgentInput(messages: UIMessage[]): AgentInputItem[]`.
- Added OpenAI Agents SDK agents, registry, and typed tools:
  - `retrieve_chunks`
  - `list_documents`
  - `workflow_status`
  - `conversation_history`
  - `search_conversation`
- Recorded each tool call in `ToolCall` with status, input, output/error, and duration metadata.
- Added `ChatService.streamChat(input: StreamChatInput): Promise<Response>`.
- Added `app/api/chat/route.ts` with the exact requested Zod body schema.
- Added conversation, message, and search API routes with current-user ownership checks and sanitized public responses.

## Files Added
- `lib/openai/message-converters.ts`
- `lib/services/chat-service.ts`
- `agents/general-assistant-agent.ts`
- `agents/document-agent.ts`
- `agents/retrieval-agent.ts`
- `agents/registry.ts`
- `agents/tools/shared.ts`
- `agents/tools/retrieve-chunks.ts`
- `agents/tools/list-documents.ts`
- `agents/tools/workflow-status.ts`
- `agents/tools/conversation-history.ts`
- `agents/tools/search-conversation.ts`
- `app/api/chat/route.ts`
- `app/api/conversations/route.ts`
- `app/api/conversations/[id]/route.ts`
- `app/api/messages/route.ts`
- `app/api/search/route.ts`
- `tests/unit/message-converters.test.ts`
- `tests/unit/agent-tools.test.ts`
- `tests/api/chat-route.test.ts`

## Implementation Notes
### Message conversion
- Converts AI SDK `UIMessage` text parts into Agents SDK input items.
- Supports `system`, `user`, and `assistant` roles.
- Falls back to legacy `content` when present.
- Drops empty text messages.

### Tools
- All tools use `tool()` from `@openai/agents` with Zod parameter schemas.
- All tool calls are persisted through `ToolCall` start/completion/failure records.
- Tool outputs are restricted to serializable domain-safe data.

### Agents
- `GeneralAssistantAgent` uses the exact required instruction string.
- `DocumentAgent` and `RetrievalAgent` specialize for document-grounded and retrieval-planning use cases.
- `agents/registry.ts` registers all agents and defaults to `GeneralAssistantAgent`.

### Chat service
- Validates owned conversations.
- Creates a conversation when one is not supplied.
- Persists the latest user message.
- Creates `AgentRun` rows.
- Runs the selected agent with `stream: true` and `conversationId`.
- Returns `createAiSdkUiMessageStreamResponse(stream)`.
- Persists assistant output, active agent metadata, completion/failure status, and searchable conversation text.
- Uses user settings model override via `SettingsService`.

### Routes
- `POST /api/chat`
- `GET/POST /api/conversations`
- `GET/PATCH/DELETE /api/conversations/[id]`
- `GET /api/messages`
- `GET /api/search`

All routes use:
- `getCurrentUser`
- `getRequestContext`
- `enforcePreProvisionRouteRateLimit`
- `rateLimit`
- `assertSameOrigin` on mutations
- `jsonOk/jsonError`

Responses omit n8n/OpenAI/internal payload leakage.

## TDD Evidence
1. Added new failing tests for:
   - message conversion
   - agent tool recording + serialization
   - chat route validation/delegation
2. Ran targeted Vitest command and confirmed failures due to missing modules.
3. Implemented code.
4. Re-ran targeted tests until green.
5. Ran `pnpm typecheck` to confirm typing correctness.

## Verification
### Focused tests
```bash
pnpm vitest run tests/unit/message-converters.test.ts tests/unit/agent-tools.test.ts tests/api/chat-route.test.ts
```
Result: 3 files passed, 8 tests passed.

### Typecheck
```bash
pnpm typecheck
```
Result: passed.

## Self-review
- Confirmed no `.gitignore` or `docs/lms_use_case.md` changes were read/edited/staged.
- Confirmed `.superpowers/` report remains untracked.
- Confirmed no TODO/TBD placeholders in added Task 7 files.
- Confirmed public routes return sanitized DTOs only.

## Concerns
- Conversation/message/search routes were implemented conservatively from the schema and existing service patterns because the brief defined file/interface requirements but not full response contracts for those endpoints.
- A small support helper file, `agents/tools/shared.ts`, was added to keep tool logging/context handling consistent.

## Task 7 Review Fixes
- Replaced `z.array(z.custom<UIMessage>())` in `POST /api/chat` with strict Zod validation for the app's supported AI SDK UI messages: optional `id`, `system|user|assistant` roles, text-only `parts`, and legacy non-empty `content` fallback. Invalid payloads now return structured validation details instead of reaching `ChatService`.
- Added shared `lib/openai/ui-messages.ts` helpers so message conversion and `ChatService` latest-user persistence both extract text from `parts` first and legacy `content` second.
- Added audit logging for sensitive authenticated mutations without logging prompt text or assistant content:
  - chat user-message creation
  - chat agent-run creation
  - implicit chat conversation create/derived rename
  - conversation create/rename/delete route mutations
- Made chat persistence transactional for conversation/message/agent-run creation plus audit records.
- Added regression coverage in `tests/api/chat-route.test.ts`, `tests/api/conversations-route.test.ts`, and `tests/unit/chat-service.test.ts`.

### Review Fix Verification
- `pnpm vitest run tests/unit/message-converters.test.ts tests/unit/agent-tools.test.ts tests/api/chat-route.test.ts` ✅
- `pnpm vitest run tests/api/conversations-route.test.ts tests/unit/chat-service.test.ts` ✅
- `pnpm typecheck` ✅

## Task 7 UIMessage/Citation Review Fixes
- Loosened `POST /api/chat` UI message validation to accept AI SDK-compatible message parts with optional `parts`, string `type`, optional `id`, enum `role`, optional string `content`, and unknown extra part fields. Text extraction still ignores non-text parts, while malformed shapes still return structured validation errors.
- Preserved the existing latest submitted user-message non-empty text guard in `ChatService`, so empty/whitespace user submissions still fail safely.
- Persisted safe assistant citations from completed `retrieve_chunks` tool calls into `Message.citations`, storing only public fields (`toolCallId`, `chunkId`, `documentId`, `documentName`, `chunkIndex`, `score`, `snippet`) and excluding raw n8n/internal payloads.
- Added regression coverage for AI SDK non-text assistant parts and assistant citation persistence.

### UIMessage/Citation Fix Verification
- `pnpm vitest run tests/unit/message-converters.test.ts tests/unit/agent-tools.test.ts tests/api/chat-route.test.ts tests/api/conversations-route.test.ts tests/unit/chat-service.test.ts` ✅
- `pnpm typecheck` ✅

## Task 7 Review Findings Fixes (Round 2)
- Awaited `chatService.streamChat(...)` in `app/api/chat/route.ts` so startup rejections stay inside the route `try/catch` and return `jsonError` responses.
- Added chat route regression coverage proving `ChatService` startup rejection returns the structured internal error payload.
- Reworked `ChatService` conversation indexing to rebuild `Conversation.searchText` from persisted `USER` and `ASSISTANT` messages instead of read-modify-write against potentially stale preloaded text.
- Removed implicit new-conversation `searchText` seeding so the first user prompt is indexed exactly once after message persistence.
- Preserved streaming response creation, citation persistence, audit logging, and agent-run completion/failure handling.

### Round 2 Verification
- `pnpm vitest run tests/unit/message-converters.test.ts tests/unit/agent-tools.test.ts tests/api/chat-route.test.ts tests/api/conversations-route.test.ts tests/unit/chat-service.test.ts` ✅ (5 files, 21 tests passed)
- `pnpm typecheck` ✅
