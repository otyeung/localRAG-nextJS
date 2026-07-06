import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { env } from '@/lib/config/env';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { parseJsonBody, validateWithSchema } from '@/lib/http/route-validation';
import { N8N_WEBHOOK_SECRET_HEADER } from '@/lib/n8n/auth';
import { IngestionCallbackService } from '@/lib/services/ingestion-callback-service';

const ingestionCallbackService = new IngestionCallbackService();

const callbackChunkSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  content: z.string().trim().min(1),
  tokenCount: z.number().int().nonnegative().nullable().optional(),
  pointId: z.string().trim().min(1).nullable().optional(),
});

const ingestionCallbackSchema = z
  .object({
    documentId: z.string().trim().min(1),
    uploadId: z.string().trim().min(1),
    externalExecutionId: z.string().trim().min(1).nullable().optional(),
    workflowId: z.string().trim().min(1).nullable().optional(),
    completedAt: z.string().datetime().nullable().optional(),
    embeddingModel: z.string().trim().min(1).nullable().optional(),
    chunks: z.array(callbackChunkSchema).min(1),
  })
  .superRefine((payload, context) => {
    const seen = new Set<number>();

    for (const [index, chunk] of payload.chunks.entries()) {
      if (seen.has(chunk.chunkIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'Chunk indexes must be unique.',
          path: ['chunks', index, 'chunkIndex'],
        });
      }
      seen.add(chunk.chunkIndex);
    }
  });

function isValidSecret(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function assertN8nWebhookSecret(request: Request): void {
  if (!isValidSecret(request.headers.get(N8N_WEBHOOK_SECRET_HEADER), env.n8n.webhookSecret)) {
    throw new AppError('FORBIDDEN', 'Invalid n8n webhook secret.');
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertN8nWebhookSecret(request);
    const payload = validateWithSchema(
      ingestionCallbackSchema,
      await parseJsonBody(request),
      'Invalid ingestion callback payload.',
    );

    return jsonOk(await ingestionCallbackService.completeIngestion(payload));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
