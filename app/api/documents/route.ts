import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { rateLimit } from '@/lib/security/rate-limit';
import { DocumentService, type DocumentQuery } from '@/lib/services/document-service';

const documentService = new DocumentService();

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
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
    const query: DocumentQuery = {
      search: url.searchParams.get('query') ?? undefined,
      status: (url.searchParams.get('status') as DocumentQuery['status']) ?? undefined,
      sort: (url.searchParams.get('sort') as DocumentQuery['sort']) ?? undefined,
      order: (url.searchParams.get('order') as DocumentQuery['order']) ?? undefined,
      page: parsePositiveInteger(url.searchParams.get('page'), 1),
      pageSize: parsePositiveInteger(url.searchParams.get('pageSize'), 20),
    };

    return jsonOk(await documentService.listDocuments(user.id, query));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
