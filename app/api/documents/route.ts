import { DocumentStatus } from '@prisma/client';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { rateLimit } from '@/lib/security/rate-limit';
import { DocumentService, toPublicDocumentDto, type DocumentQuery } from '@/lib/services/document-service';

const documentService = new DocumentService();
const documentQuerySchema = z.object({
  search: z.preprocess(
    (value) => {
      if (typeof value !== 'string') {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    },
    z.string().min(1).optional(),
  ),
  status: z.enum(Object.keys(DocumentStatus) as [keyof typeof DocumentStatus, ...Array<keyof typeof DocumentStatus>]).optional(),
  sort: z.enum(['createdAt', 'updatedAt', 'title']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'documents-api',
      action: 'get',
      errorMessage: 'Too many document requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`documents:get:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'documents-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many document requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const url = new URL(request.url);
    const query: DocumentQuery = validateWithSchema(
      documentQuerySchema,
      {
        search: url.searchParams.get('query') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        sort: url.searchParams.get('sort') ?? undefined,
        order: url.searchParams.get('order') ?? undefined,
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      },
      'Invalid document query parameters.',
    );

    const result = await documentService.listDocuments(user.id, query);

    return jsonOk({
      ...result,
      items: result.items.map(toPublicDocumentDto),
    });
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
