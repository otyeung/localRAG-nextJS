import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { UploadService } from '@/lib/services/upload-service';

const uploadService = new UploadService();

export async function POST(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      throw new AppError('BAD_REQUEST', 'A file upload is required.');
    }

    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`upload:post:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'upload-api',
      limit: 5,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many upload requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const upload = await uploadService.createUpload({
      userId: user.id,
      fileName: file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    return jsonOk(upload);
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
