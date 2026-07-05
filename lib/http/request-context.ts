import { nanoid } from 'nanoid';

export type RequestContext = {
  requestId: string;
  ipAddress: string;
  userAgent: string;
};

function parseForwardedIp(request: Request): string | undefined {
  if (process.env.TRUST_PROXY_HEADERS !== 'true') {
    return undefined;
  }

  return request.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim()
    .replace(/^"|"$/g, '');
}

export function getRequestContext(request: Request): RequestContext {
  return {
    requestId: request.headers.get('x-request-id') ?? nanoid(),
    ipAddress: parseForwardedIp(request) ?? 'unknown',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  };
}
