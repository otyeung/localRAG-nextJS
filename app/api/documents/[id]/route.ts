import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { DocumentService, type DocumentDto } from '@/lib/services/document-service';

const documentService = new DocumentService();
function toPublicDocumentDto(document: DocumentDto) {
  return {
    id: document.id,
    uploadId: document.uploadId,
    status: document.status,
    title: document.title,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    deletedAt: document.deletedAt,
  };
}
const documentRouteParamsSchema = z.object({
  id: z.string().trim().min(1, 'Document id is required.'),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const { id } = validateWithSchema(documentRouteParamsSchema, await context.params, 'Invalid document route parameters.');
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'documents-api',
      action: 'get',
      errorMessage: 'Too many document requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`documents:get-one:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'documents-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many document requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    return jsonOk(toPublicDocumentDto(await documentService.getDocument(user.id, id)));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    const { id } = validateWithSchema(documentRouteParamsSchema, await context.params, 'Invalid document route parameters.');
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'documents-api',
      action: 'delete',
      errorMessage: 'Too many document requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`documents:delete:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'documents-api',
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many document requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    return jsonOk(
      toPublicDocumentDto(
        await documentService.softDeleteDocument(user.id, id, {
          requestId: requestContext.requestId,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
        }),
      ),
    );
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
