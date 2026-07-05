# Security operations

## Secret handling

- Keep `OPENAI_API_KEY`, `DATABASE_URL`, `N8N_API_KEY`, `N8N_WEBHOOK_SECRET`, and `ANONYMOUS_COOKIE_SECRET` server-side only.
- Do not expose secrets through browser bundles, client props, or public env vars.
- `lib/config/env.ts` is the authoritative server-side env parser.

## Browser-to-server boundary

- The browser should talk only to Next.js routes.
- n8n remains behind the internal service layer in `lib/n8n/*`.
- Qdrant and n8n should stay internal-only in Docker Compose; do not publish them as public app APIs.

## Headers and request hardening

- `middleware.ts` applies:
  - Content Security Policy
  - `x-request-id`
  - `x-content-type-options: nosniff`
  - `referrer-policy: strict-origin-when-cross-origin`
- Mutation routes should continue enforcing same-origin CSRF checks via `lib/security/csrf.ts`.

## Rate limiting

- Chat, upload, search, and workflow retry paths should use `lib/security/rate-limit.ts`.
- The current limiter is in-memory, so operators should reassess this implementation before multi-instance production deployment.

## Upload safety

- `UploadValidationService` enforces extension, MIME, and max-size checks before ingestion.
- Temporary uploads must live in isolated writable storage.
- Keep `MAX_UPLOAD_SIZE` aligned with operational expectations.
- Only advertise file types that are implemented end to end.

## Virus scan seam

- `VirusScanService` is intentionally a seam.
- The current adapter returns a local no-op `clean` result.
- Replace it with a real scanner before production environments that require malware screening.

## Identity and authorization

- Anonymous users are represented by HMAC-signed cookies in `lib/auth/anonymous-provider.ts`.
- Route handlers and services must continue checking ownership for conversations, messages, documents, uploads, workflows, and settings.
- Future enterprise identity providers should plug into this boundary without rewriting service logic.

## Audit logging

- `AuditService` persists security-relevant events for uploads, deletes, settings changes, workflow retries, and agent/tool actions.
- Preserve request IDs, IPs, and user agents where available.

## n8n isolation

- n8n workflow calls must stay server-to-server.
- Internal triggers must validate `x-n8n-webhook-secret`.
- If `N8N_API_KEY` is provisioned, use it only from the internal service layer with `X-N8N-API-KEY`.

## Production checklist

- [ ] All secrets provisioned outside source control
- [ ] `TEMP_UPLOAD_DIRECTORY` points to isolated writable storage
- [ ] CSP and CSRF protections enabled
- [ ] Rate limits enabled on mutation and retrieval routes
- [ ] Upload validation and size limits verified
- [ ] Virus scan adapter reviewed for environment risk
- [ ] Audit logging retained and queryable
- [ ] n8n and Qdrant not publicly exposed
