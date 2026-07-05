import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { rateLimit } from '@/lib/security/rate-limit';
import { WorkflowService } from '@/lib/services/workflow-service';

const workflowService = new WorkflowService();
const workflowRouteParamsSchema = z.object({
  id: z.string().trim().min(1, 'Workflow id is required.'),
});

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const { id } = validateWithSchema(workflowRouteParamsSchema, await context.params, 'Invalid workflow route parameters.');
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`workflows:get-one:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'workflows-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many workflow requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    return jsonOk(await workflowService.getPublicWorkflowStatus(user.id, id));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
