import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { rateLimit } from '@/lib/security/rate-limit';
import { WorkflowService } from '@/lib/services/workflow-service';

const workflowService = new WorkflowService();
const workflowQuerySchema = z.object({
  documentIds: z.preprocess(
    (value) => {
      if (!Array.isArray(value)) {
        return value;
      }

      if (value.length === 0) {
        return undefined;
      }

      return value.map((item) => (typeof item === 'string' ? item.trim() : item));
    },
    z.array(z.string().min(1)).max(100).optional(),
  ),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'workflows-api',
      action: 'get',
      errorMessage: 'Too many workflow requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`workflows:get:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'workflows-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many workflow requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const url = new URL(request.url);
    const query = validateWithSchema(
      workflowQuerySchema,
      {
        documentIds: url.searchParams.getAll('documentIds'),
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      },
      'Invalid workflow query parameters.',
    );

    return jsonOk(
      await workflowService.listPublicWorkflows(user.id, {
        ...(query.documentIds ? { documentIds: query.documentIds } : {}),
        ...(typeof query.pageSize === 'number' ? { pageSize: query.pageSize } : {}),
      }),
    );
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
