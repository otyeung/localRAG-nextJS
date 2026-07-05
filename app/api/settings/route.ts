import { z } from 'zod';

import { createAnonymousRequestFingerprint, getVerifiedAnonymousFingerprint } from '@/lib/auth/anonymous-provider';
import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { getRequestContext, type RequestContext } from '@/lib/http/request-context';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { SettingsService } from '@/lib/services/settings-service';

const settingsService = new SettingsService();
const PRE_PROVISION_RATE_LIMIT = 30;
const PRE_PROVISION_RATE_WINDOW_MS = 60_000;
/**
 * Global guardrail for requests without a valid anonymous cookie.
 * Keep this comfortably above the per-fingerprint/IP 30/min bucket so ordinary
 * first-time clients do not block one another, while still capping anonymous
 * user creation and rate-limit bucket growth during bursts.
 */
const PRE_PROVISION_NEW_ANONYMOUS_GLOBAL_LIMIT = 300;
const PRE_PROVISION_NEW_ANONYMOUS_GLOBAL_KEY = 'settings:pre:new-anonymous:global';

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
    limit: PRE_PROVISION_RATE_LIMIT,
    windowMs: PRE_PROVISION_RATE_WINDOW_MS,
  });

  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many settings requests.', {
      resetAt: result.resetAt.toISOString(),
    });
  }
}

function buildPreProvisionRateLimitKey(request: Request, requestContext: RequestContext, method: 'get' | 'patch'): string {
  const anonymousFingerprint = getVerifiedAnonymousFingerprint(request);

  if (anonymousFingerprint) {
    return `settings:pre:${method}:cookie:${anonymousFingerprint}`;
  }

  if (requestContext.ipAddress !== 'unknown') {
    return `settings:pre:${method}:ip:${requestContext.ipAddress}`;
  }

  return `settings:pre:${method}:fingerprint:${createAnonymousRequestFingerprint({
    method,
    userAgent: request.headers.get('user-agent') ?? '',
    acceptLanguage: request.headers.get('accept-language') ?? '',
    secChUa: request.headers.get('sec-ch-ua') ?? '',
    secChUaPlatform: request.headers.get('sec-ch-ua-platform') ?? '',
  })}`;
}

async function enforcePreProvisionRateLimit(
  request: Request,
  requestContext: RequestContext,
  method: 'get' | 'patch',
): Promise<void> {
  const anonymousFingerprint = getVerifiedAnonymousFingerprint(request);
  const result = await rateLimit(buildPreProvisionRateLimitKey(request, requestContext, method), {
    namespace: 'settings-api-pre-auth',
    limit: PRE_PROVISION_RATE_LIMIT,
    windowMs: PRE_PROVISION_RATE_WINDOW_MS,
  });

  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', 'Too many settings requests.', {
      resetAt: result.resetAt.toISOString(),
    });
  }

  if (!anonymousFingerprint) {
    const newAnonymousResult = await rateLimit(PRE_PROVISION_NEW_ANONYMOUS_GLOBAL_KEY, {
      namespace: 'settings-api-pre-auth-new-anonymous',
      limit: PRE_PROVISION_NEW_ANONYMOUS_GLOBAL_LIMIT,
      windowMs: PRE_PROVISION_RATE_WINDOW_MS,
    });

    if (!newAnonymousResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many settings requests.', {
        resetAt: newAnonymousResult.resetAt.toISOString(),
      });
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    await enforcePreProvisionRateLimit(request, requestContext, 'get');
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
    await enforcePreProvisionRateLimit(request, requestContext, 'patch');

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
