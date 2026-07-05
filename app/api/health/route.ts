import { logger } from '@/lib/logger/logger';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { toAppError } from '@/lib/http/api-errors';
import { HealthService } from '@/lib/services/health-service';

const healthService = new HealthService();

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const health = await healthService.getHealth();

    return jsonOk(health, {
      status: health.status === 'unhealthy' ? 503 : 200,
    });
  } catch (error) {
    logger.error({ error, requestId: requestContext.requestId }, 'Failed to load system health.');

    return jsonError(toAppError(error), requestContext.requestId);
  }
}
