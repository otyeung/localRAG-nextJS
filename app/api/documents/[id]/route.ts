import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { DocumentService } from '@/lib/services/document-service';

const documentService = new DocumentService();

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const { id } = await context.params;
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

    return jsonOk(await documentService.getDocument(user.id, id));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    const { id } = await context.params;
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
      await documentService.softDeleteDocument(user.id, id, {
        requestId: requestContext.requestId,
        ipAddress: requestContext.ipAddress,
        userAgent: requestContext.userAgent,
      }),
    );
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
