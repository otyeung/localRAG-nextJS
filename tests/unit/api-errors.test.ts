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
    const error = toAppError(new Error('Boom: database ******'));

    expect(error.code).toBe('INTERNAL_ERROR');
    expect(error.message).toBe('An unexpected error occurred.');
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

  it('does not expose internal error details', async () => {
    const response = jsonError(toAppError(new Error('Boom: database ******')), 'request-2');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: 'request-2',
      },
    });
  });

  it('does not expose direct internal app error details', async () => {
    const response = jsonError(
      new AppError('INTERNAL_ERROR', 'Sensitive failure', {
        token: 'secret',
        nested: { password: 'hidden' },
      }),
      'request-2b',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: 'request-2b',
      },
    });
  });

  it('serializes bigint app error details safely', async () => {
    const response = jsonError(new AppError('BAD_REQUEST', 'Invalid input', { amount: 1n }), 'request-3');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        requestId: 'request-3',
        details: { amount: '1' },
      },
    });
  });

  it('serializes circular app error details safely', async () => {
    const details: Record<string, unknown> = { name: 'loop' };
    details.self = details;

    const response = jsonError(new AppError('BAD_REQUEST', 'Invalid input', details), 'request-4');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        requestId: 'request-4',
        details: {
          name: 'loop',
          self: { message: 'Details could not be serialized.' },
        },
      },
    });
  });

  it('falls back when details getter throws', async () => {
    const details = {};
    Object.defineProperty(details, 'danger', {
      enumerable: true,
      get() {
        throw new Error('getter exploded');
      },
    });

    const response = jsonError(new AppError('BAD_REQUEST', 'Invalid input', details), 'request-5');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        requestId: 'request-5',
        details: { message: 'Details could not be serialized.' },
      },
    });
  });

  it('falls back when app error details accessor throws', async () => {
    const error = new AppError('BAD_REQUEST', 'Invalid input', { ok: true });
    Object.defineProperty(error, 'details', {
      enumerable: true,
      get() {
        throw new Error('details accessor exploded');
      },
    });

    const response = jsonError(error, 'request-7');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        requestId: 'request-7',
        details: { message: 'Details could not be serialized.' },
      },
    });
  });

  it('falls back when proxy traps throw during serialization', async () => {
    const details = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('ownKeys exploded');
        },
      },
    );

    const response = jsonError(new AppError('BAD_REQUEST', 'Invalid input', details), 'request-6');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid input',
        requestId: 'request-6',
        details: { message: 'Details could not be serialized.' },
      },
    });
  });
});
