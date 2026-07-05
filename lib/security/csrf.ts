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

  let originHost: string;

  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError('FORBIDDEN', 'Cross-origin mutation rejected.');
  }

  if (originHost !== host) {
    throw new AppError('FORBIDDEN', 'Cross-origin mutation rejected.');
  }
}
