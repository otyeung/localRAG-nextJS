import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/http/api-errors';
import { assertSameOrigin } from '@/lib/security/csrf';

describe('assertSameOrigin', () => {
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

  it('allows the effective origin when scheme and host match', () => {
    const request = new Request('https://app.example.com/api/upload', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-forwarded-proto': 'https',
      },
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });
});
