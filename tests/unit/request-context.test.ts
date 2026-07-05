import { afterEach, describe, expect, it } from 'vitest';

import { getRequestContext } from '@/lib/http/request-context';

const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
const mutableProcessEnv = process.env as NodeJS.ProcessEnv & { TRUST_PROXY_HEADERS?: string };

afterEach(() => {
  mutableProcessEnv.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
});

describe('getRequestContext', () => {
  it('ignores spoofed x-forwarded-for by default', () => {
    delete mutableProcessEnv.TRUST_PROXY_HEADERS;

    const request = new Request('https://app.example.com/api/upload', {
      headers: {
        'x-forwarded-for': '203.0.113.10',
      },
    });

    expect(getRequestContext(request).ipAddress).toBe('unknown');
  });

  it('honors x-forwarded-for when proxy headers are trusted', () => {
    mutableProcessEnv.TRUST_PROXY_HEADERS = 'true';

    const request = new Request('https://app.example.com/api/upload', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.5',
      },
    });

    expect(getRequestContext(request).ipAddress).toBe('203.0.113.10');
  });
});
