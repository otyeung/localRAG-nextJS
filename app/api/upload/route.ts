import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { env } from '@/lib/config/env';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { UploadValidationService } from '@/lib/services/upload-validation-service';
import { UploadService, type UploadResult } from '@/lib/services/upload-service';

const uploadService = new UploadService();
const uploadValidationService = new UploadValidationService({ maxBytes: env.upload.maxBytes });
const uploadMetadataSchema = z.object({
  fileName: z.string().trim().min(1, 'File name is required.'),
  mimeType: z.string().trim().min(1, 'MIME type is required.'),
  size: z.number().int().positive('File size must be greater than zero.'),
});

function toPublicUploadResult(upload: UploadResult) {
  return {
    uploadId: upload.uploadId,
    documentId: upload.documentId,
    workflowExecutionId: upload.workflowExecutionId,
    status: upload.status,
    reconciliationRequired: upload.reconciliationRequired,
  };
}

export async function POST(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
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

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      throw new AppError('BAD_REQUEST', 'A file upload is required.');
    }

    const uploadMetadata = validateWithSchema(
      uploadMetadataSchema,
      {
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      },
      'Invalid upload metadata.',
    );
    await uploadValidationService.validate(uploadMetadata);

    const upload = await uploadService.createUpload({
      userId: user.id,
      fileName: uploadMetadata.fileName,
      mimeType: uploadMetadata.mimeType,
      bytes: new Uint8Array(await file.arrayBuffer()),
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    return jsonOk(toPublicUploadResult(upload));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
