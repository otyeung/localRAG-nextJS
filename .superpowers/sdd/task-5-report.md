# Task 5 Report

## Status
DONE

## Summary
Implemented the typed `lib/n8n/` service layer for client access, auth headers, errors, workflow start/list operations, execution retrieval and polling, health checks, ingestion start, retrieval calls, and shared DTO/types. Added focused unit coverage for client retry/auth behavior, invalid JSON non-retry behavior, execution normalization, and execution polling.

## Files Added
- `lib/n8n/types.ts`
- `lib/n8n/errors.ts`
- `lib/n8n/auth.ts`
- `lib/n8n/client.ts`
- `lib/n8n/workflow.ts`
- `lib/n8n/executions.ts`
- `lib/n8n/health.ts`
- `lib/n8n/ingestion.ts`
- `lib/n8n/retrieval.ts`
- `lib/n8n/documents.ts`
- `tests/unit/n8n-client.test.ts`
- `tests/unit/n8n-executions.test.ts`

## TDD Notes
1. Wrote `tests/unit/n8n-client.test.ts` and `tests/unit/n8n-executions.test.ts` before implementation.
2. Ran the focused Vitest command and observed failing imports for missing `lib/n8n/*` modules.
3. Implemented the service layer to satisfy the tests.
4. Added failing regression tests after code review for invalid JSON retry behavior and execution polling.
5. Re-ran focused tests and typecheck to green.

## Validation
- `pnpm vitest run tests/unit/n8n-client.test.ts tests/unit/n8n-executions.test.ts`
- `pnpm typecheck`

## Self-Review
- Confirmed retries are limited to `408`, `429`, and `5xx` responses only.
- Confirmed every public service response path uses Zod validation before returning domain objects.
- Confirmed execution tracking now includes polling until terminal status with bounded attempts.
- Kept scope limited to Task 5; no upload routes, document routes, or Docker workflow assets were added.

## Code Review Follow-up
Addressed two review findings before completion:
- prevented retries for successful responses with invalid JSON bodies to avoid duplicate webhook side effects
- added execution polling support for workflow status tracking

## Commit
- `d04ddcf feat: add typed n8n service layer`

## Fix Report - Workflow Pagination

- Implemented cursor-based pagination in `N8nWorkflowService.listActiveWorkflows()` so it keeps fetching `/api/v1/workflows` until `nextCursor` is empty.
- Preserved the `active=true` filter and `requestId` propagation on every page request.
- Added a unit test covering two pages being fetched and combined into a single workflow list.
- Verification:
  - `pnpm vitest run tests/unit/n8n-client.test.ts tests/unit/n8n-executions.test.ts`
  - `pnpm typecheck`

## Fix Report - Workflow Key Mismatch

- Changed the ingestion workflow key constant from `document-ingestion` to `ingestion` so `N8nIngestionService.startDocumentIngestion()` posts to `/webhook/ingestion`.
- Kept retrieval unchanged at `retrieval`.
- Added a unit test that verifies the ingestion service posts to the ingestion webhook path.
- Updated repository integration expectations to match the new ingestion workflow key.
- Verification:
  - `pnpm vitest run tests/unit/n8n-client.test.ts tests/unit/n8n-executions.test.ts`
  - `pnpm typecheck`

## Fix Report - Failure-Path Review Findings

- Wrapped `N8nExecutionService.getExecution()` response validation in `N8nError` so malformed execution payloads now surface as `UPSTREAM_ERROR` instead of raw Zod errors.
- Added safe `N8nError` wrapping around service-level Zod input validation in ingestion and retrieval services.
- Classified fetch transport failures and Abort/timeout errors as retryable `N8nError`s in `N8nClient`, so they retry up to `retryCount` before failing and still feed the circuit breaker.
- Added regression coverage for malformed execution payloads, transport retry success, and abort-style retry exhaustion.
- Verification:
  - `pnpm vitest run tests/unit/n8n-client.test.ts tests/unit/n8n-executions.test.ts`
  - `pnpm typecheck`
