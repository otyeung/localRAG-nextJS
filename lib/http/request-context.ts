import { nanoid } from 'nanoid';

export type RequestContext = {
  requestId: string;
  ipAddress: string;
  userAgent: string;
};

export function getRequestContext(request: Request): RequestContext {
  return {
    requestId: request.headers.get('x-request-id') ?? nanoid(),
    ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  };
}
