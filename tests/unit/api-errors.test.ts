import { describe, expect, it } from 'vitest';

import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';

describe('AppError', () => {
  it('maps codes to HTTP statuses', () => {
    const error = new AppError('RATE_LIMITED', 'Too many requests');

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.status).toBe(429);
  });

  it('converts unknown errors to internal errors', () => {
    const error = toAppError(new Error('Boom'));

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('Boom');
  });
});

describe('json response helpers', () => {
  it('wraps success payloads', async () => {
    const response = jsonOk({ ok: true });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
  });

  it('serializes app errors', async () => {
    const response = jsonError(new AppError('FORBIDDEN', 'Denied', { scope: 'admin' }), 'request-1');

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Denied',
        requestId: 'request-1',
        details: { scope: 'admin' },
      },
    });
  });
});
