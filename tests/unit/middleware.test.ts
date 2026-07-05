import type { NextRequest } from 'next/server';

import { afterEach, describe, expect, it } from 'vitest';

import { middleware } from '@/middleware';

const originalNodeEnv = process.env.NODE_ENV;
const mutableProcessEnv = process.env as NodeJS.ProcessEnv & { NODE_ENV?: string };

afterEach(() => {
  mutableProcessEnv.NODE_ENV = originalNodeEnv;
});

describe('middleware', () => {
  it('adds a nonce-based production CSP and forwards the nonce', () => {
    mutableProcessEnv.NODE_ENV = 'production';

    const request = new Request('https://app.example.com/api/upload', {
      headers: { 'x-request-id': 'request-123' },
    }) as NextRequest;

    const response = middleware(request);
    const csp = response.headers.get('content-security-policy');
    const nonce = response.headers.get('x-middleware-request-x-nonce');
    const scriptSrc = csp?.match(/script-src[^;]+/)?.[0] ?? '';

    expect(response.headers.get('x-request-id')).toBe('request-123');
    expect(response.headers.get('x-middleware-override-headers')).toContain('x-nonce');
    expect(nonce).toBeTruthy();
    expect(scriptSrc).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
  });

  it('keeps dev script directives compatible with Next dev', () => {
    mutableProcessEnv.NODE_ENV = 'development';

    const request = new Request('https://app.example.com/api/upload', {
      headers: { 'x-request-id': 'request-123' },
    }) as NextRequest;

    const response = middleware(request);
    const csp = response.headers.get('content-security-policy');
    const scriptSrc = csp?.match(/script-src[^;]+/)?.[0] ?? '';

    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
