import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/http/api-errors';
import { assertSameOrigin } from '@/lib/security/csrf';

describe('assertSameOrigin', () => {
  it('allows safe methods without origin or host headers', () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'GET',
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('allows an explicit default port when the origin matches the effective request origin', () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com:443',
        origin: 'https://app.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it('rejects a mismatched scheme even when the host matches', () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'http://app.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).toThrow(AppError);
  });

  it('rejects unsafe requests with a missing origin header', () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).toThrow(AppError);
  });

  it('rejects unsafe requests with a missing host header', () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        origin: 'https://app.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).toThrow(AppError);
  });
});
