# Task 6 Report

## Summary
Implemented Task 6 upload/document/workflow foundation work for the local RAG app.

## Delivered
- Added `UploadValidationService` with MIME/extension, size, and filename validation.
- Added `VirusScanService` noop seam for future AV integration.
- Added `AppQdrantClient` wrapper with `ping()` and `ensureCollection()`.
- Added `UploadService` to validate uploads, persist temp files, hash content, create upload/document/workflow records, start n8n ingestion, and record audit events.
- Added `DocumentService` to list/search/get/delete documents and request re-indexing.
- Added `WorkflowService` to list workflows, poll running n8n executions, normalize workflow status, and sync upload/document statuses.
- Added API routes:
  - `POST /api/upload`
  - `GET /api/uploads`
  - `GET /api/documents`
  - `GET /api/documents/[id]`
  - `DELETE /api/documents/[id]`
  - `GET /api/workflows`
  - `GET /api/workflows/[id]`
- Reworked `scripts/seed-corpus.ts` to create/reuse the anonymous user, skip already-ready hashes, upload missing PDFs through `UploadService`, and poll workflow completion.

## TDD Evidence
### Red
Created failing tests first for:
- upload validation
- upload/document/workflow service behavior
- upload API route
- documents API routes
- corpus seeding flow

Verified initial failures from missing modules and missing seed result shape.

### Green
Implemented the minimum production code needed for the new tests and iterated until all targeted tests passed.

## Tests Run
- `pnpm vitest run tests/unit/upload-validation.test.ts tests/unit/document-services.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts tests/integration/seed-corpus.test.ts`
- `pnpm typecheck`

## Verification Result
Latest verification passed:
- 5 test files passed
- 13 tests passed
- `tsc --noEmit` passed

## Self-Review
- Confirmed routes use `jsonOk/jsonError`, request context, auth, and rate limiting.
- Confirmed mutation routes enforce same-origin checks.
- Confirmed no n8n base URL, credentials, or internal secrets are returned in API responses.
- Confirmed seeded corpus uses the same upload service path as normal uploads.

## Notes / Concerns
- Workflow and upload listing routes were implemented even though the brief only required focused tests for upload/documents; they are covered by typecheck but not by dedicated route tests in this task.

## Task 6 Review Fixes
- Added route-level Zod validation helpers for upload multipart metadata, document list query params, document IDs, and workflow IDs so invalid trust-boundary inputs return `VALIDATION_ERROR` responses with structured field details.
- Updated `UploadService.createUpload()` to create upload/document/workflow records inside a Prisma transaction, generate cryptographically unique temp filenames with sanitized basename/extension, and remove persisted temp files whenever any later step fails.
- Updated `DocumentService.requestReindex()` to write workflow/document state changes and a `document.reindex_requested` audit event in the same transaction.
- Added regression coverage for invalid route params, transactional upload creation, temp-file cleanup, unique temp paths, and reindex audit logging.

## Review Fix Verification
- `pnpm vitest run tests/unit/upload-validation.test.ts tests/unit/document-services.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts tests/integration/seed-corpus.test.ts`
- `pnpm typecheck`

## Review Fix Result
- 5 test files passed / 19 tests passed.
- `tsc --noEmit` passed.

## Task 6 Orchestration / Seed Review Fixes
- Refactored `UploadService.createUpload()` so only true ingestion-start failures mark upload/document/workflow records failed and remove the temp file; once n8n accepts the job, accepted workflow state is persisted transactionally and post-start local persistence failures now surface as reconciliation-needed errors without corrupting live ingestion state.
- Refactored `DocumentService.requestReindex()` to create the local workflow first, start n8n second, then persist accepted workflow/document/audit state transactionally; if that post-start transaction fails, the workflow is updated with external execution metadata plus reconciliation markers instead of being left misleadingly `QUEUED`.
- Added regression coverage for both post-start local failure paths to lock in the new orchestration behavior.
- Updated `scripts/seed-corpus.ts` to locate the repository root by walking upward from `process.cwd()` and the script directory until both `package.json` and the corpus PDFs are found, so `pnpm seed:corpus` works from nested directories too.

## Task 6 Orchestration / Seed Verification
- `pnpm vitest run tests/unit/upload-validation.test.ts tests/unit/document-services.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts tests/integration/seed-corpus.test.ts`
- `pnpm typecheck`

## Task 6 Orchestration / Seed Result
- 5 test files passed / 22 tests passed.
- `tsc --noEmit` passed.

## Task 6 Edge Blocker Fixes
- `UploadService.createUpload()` now returns upload/document/workflow handles with `reconciliationRequired` after n8n accepts ingestion but post-start local persistence fails, instead of throwing away the accepted workflow handle.
- `WorkflowService.getWorkflowStatus()` now reconciles upload/document statuses for already-accepted workflows flagged for reconciliation, including terminal remote completions.
- `scripts/seed-corpus.ts` now detects and reuses existing accepted ingestion records by file hash before creating a new upload, preventing duplicate ingestion on retry paths.
- `POST /api/upload` now validates file metadata and max size before calling `arrayBuffer()`, so oversize uploads are rejected without buffering file bytes.
- `DocumentService.softDeleteDocument()` now performs document deletion and audit-log creation inside one Prisma transaction.

## Task 6 Edge Blocker Verification
- `pnpm vitest run tests/unit/upload-validation.test.ts tests/unit/document-services.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts tests/integration/seed-corpus.test.ts`
- `pnpm typecheck`

## Task 6 Edge Blocker Result
- 5 test files passed / 25 tests passed.
- `tsc --noEmit` passed.

## Task 6 Public API Boundary Fixes
- Added public-response mapping for upload, document, and workflow APIs so public responses keep stable app identifiers/status/timestamps while omitting `storagePath`, `fileHash`, external n8n execution IDs, raw workflow payloads, and raw metadata.
- Kept internal service DTOs available for server-side workflows and seed/reconciliation logic, while adding sanitized workflow public DTO helpers for route consumption.
- Reordered `POST /api/upload` so same-origin checks, request context, current-user resolution, and rate limiting happen before `request.formData()`, preventing expensive multipart parsing for rejected abusive requests.
- Added regression coverage proving upload/document public responses omit internal fields and rate-limited upload requests do not call `formData()`.

## Task 6 Public API Boundary Verification
- `pnpm vitest run tests/unit/upload-validation.test.ts tests/unit/document-services.test.ts tests/api/upload-route.test.ts tests/api/documents-route.test.ts tests/integration/seed-corpus.test.ts`
- `pnpm typecheck`

## Task 6 Public API Boundary Result
- 5 test files passed / 31 tests passed.
- `tsc --noEmit` passed.
