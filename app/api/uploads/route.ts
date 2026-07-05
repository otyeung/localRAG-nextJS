import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { rateLimit } from '@/lib/security/rate-limit';
import { UploadService } from '@/lib/services/upload-service';

const uploadService = new UploadService();

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`uploads:get:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'uploads-api',
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many upload history requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    return jsonOk(await uploadService.listUploads(user.id));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
