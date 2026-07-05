import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

export function middleware(request: NextRequest): NextResponse {
  const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID();
  const forwardedHeaders = new Headers(request.headers);
  const isDevelopment = process.env.NODE_ENV === 'development';
  const nonce = createNonce();
  const scriptSrc = isDevelopment
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;

  forwardedHeaders.set('x-request-id', requestId);
  forwardedHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({
    request: {
      headers: forwardedHeaders,
    },
  });

  response.headers.set('x-request-id', requestId);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'content-security-policy',
    `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';`,
  );

  return response;
}
