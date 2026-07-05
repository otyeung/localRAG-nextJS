import { AppError } from '@/lib/http/api-errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) {
    return;
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!origin || !host) {
    return;
  }

  const requestUrl = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const requestProto = forwardedProto ?? requestUrl.protocol.slice(0, -1);
  let requestOrigin: string;
  let effectiveOrigin: string;

  try {
    requestOrigin = new URL(origin).origin;
    effectiveOrigin = new URL(`${requestProto}://${host}`).origin;
  } catch {
    throw new AppError('FORBIDDEN', 'Cross-origin mutation rejected.');
  }

  if (requestOrigin !== effectiveOrigin) {
    throw new AppError('FORBIDDEN', 'Cross-origin mutation rejected.');
  }
}
