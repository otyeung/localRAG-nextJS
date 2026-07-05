import { getVerifiedAnonymousFingerprint } from '@/lib/auth/anonymous-provider';
import { AppError } from '@/lib/http/api-errors';
import type { RequestContext } from '@/lib/http/request-context';
import { rateLimit } from '@/lib/security/rate-limit';

const PRE_PROVISION_RATE_LIMIT = 30;
const PRE_PROVISION_RATE_WINDOW_MS = 60_000;
const PRE_PROVISION_NEW_ANONYMOUS_GLOBAL_LIMIT = 300;

type PreProvisionRouteRateLimitOptions = {
  namespace: string;
  action: 'get' | 'post' | 'patch' | 'delete';
  errorMessage: string;
};

function buildPreProvisionRateLimitKey(
  request: Request,
  requestContext: RequestContext,
  options: PreProvisionRouteRateLimitOptions,
): string | undefined {
  const anonymousFingerprint = getVerifiedAnonymousFingerprint(request);

  if (anonymousFingerprint) {
    return `${options.namespace}:pre:${options.action}:cookie:${anonymousFingerprint}`;
  }

  if (requestContext.ipAddress !== 'unknown') {
    return `${options.namespace}:pre:${options.action}:ip:${requestContext.ipAddress}`;
  }

  return undefined;
}

export async function enforcePreProvisionRouteRateLimit(
  request: Request,
  requestContext: RequestContext,
  options: PreProvisionRouteRateLimitOptions,
): Promise<void> {
  const preProvisionKey = buildPreProvisionRateLimitKey(request, requestContext, options);

  if (preProvisionKey) {
    const result = await rateLimit(preProvisionKey, {
      namespace: `${options.namespace}-pre-auth`,
      limit: PRE_PROVISION_RATE_LIMIT,
      windowMs: PRE_PROVISION_RATE_WINDOW_MS,
    });

    if (!result.allowed) {
      throw new AppError('RATE_LIMITED', options.errorMessage, {
        resetAt: result.resetAt.toISOString(),
      });
    }

    return;
  }

  const result = await rateLimit(`${options.namespace}:pre:new-anonymous:global`, {
    namespace: `${options.namespace}-pre-auth-new-anonymous`,
    limit: PRE_PROVISION_NEW_ANONYMOUS_GLOBAL_LIMIT,
    windowMs: PRE_PROVISION_RATE_WINDOW_MS,
  });

  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', options.errorMessage, {
      resetAt: result.resetAt.toISOString(),
    });
  }
}
