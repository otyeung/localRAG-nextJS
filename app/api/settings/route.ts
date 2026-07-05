import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext } from '@/lib/http/request-context';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { SettingsService } from '@/lib/services/settings-service';

const settingsService = new SettingsService();

const settingsPatchSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']).optional(),
    model: z.string().min(1).optional(),
    showReasoningMetadata: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one settings field must be provided.',
  });

async function enforceRateLimit(key: string): Promise<void> {
  const result = await rateLimit(key, {
    namespace: 'settings-api',
    limit: 30,
    windowMs: 60_000,
  });

  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many settings requests.', {
      resetAt: result.resetAt.toISOString(),
    });
  }
}

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const user = await getCurrentUser(request);
    await enforceRateLimit(`settings:get:${user.id}:${requestContext.ipAddress}`);
    const settings = await settingsService.getForUser(user.id);

    return jsonOk(settings);
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      throw new AppError('BAD_REQUEST', 'Invalid JSON body.');
    }

    const parsed = settingsPatchSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Invalid settings payload.', parsed.error.flatten());
    }

    const user = await getCurrentUser(request);
    await enforceRateLimit(`settings:patch:${user.id}:${requestContext.ipAddress}`);
    const settings = await settingsService.updateForUserWithAudit(user.id, parsed.data, {
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });

    return jsonOk(settings);
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
