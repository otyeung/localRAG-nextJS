import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  setCookie: vi.fn(),
  findOrCreateAnonymousUser: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: authMocks.setCookie,
  })),
}));

vi.mock('nanoid', () => ({
  nanoid: authMocks.nanoid,
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/repositories/user-repository', () => ({
  UserRepository: class {
    findOrCreateAnonymousUser = authMocks.findOrCreateAnonymousUser;
  },
}));

import {
  createAnonymousCookieValue,
  createAnonymousFingerprintHash,
  verifyAnonymousCookieValue,
} from '@/lib/auth/anonymous-provider';
import { getCurrentUser } from '@/lib/auth/current-user';

describe('anonymous auth provider', () => {
  beforeEach(() => {
    authMocks.nanoid.mockReset();
    authMocks.nanoid
      .mockReturnValueOnce('0123456789abcdefghijklmnopqrstuv')
      .mockReturnValueOnce('abcdefghijklmnopqrstuvwxyzABCDEF')
      .mockReturnValue('ZYXWVUTSRQPONMLKJIHGFEDCBA987654');
    authMocks.findOrCreateAnonymousUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
    });
  });

  afterEach(() => {
    authMocks.setCookie.mockReset();
    authMocks.findOrCreateAnonymousUser.mockReset();
  });

  it('creates a stable hash from a client fingerprint', async () => {
    const first = await createAnonymousFingerprintHash('browser-a');
    const second = await createAnonymousFingerprintHash('browser-a');

    expect(first).toBe(second);
    expect(first).not.toContain('browser-a');
  });

  it('accepts a signed anonymous cookie and keeps it stable', async () => {
    const fingerprint = 'knownfingerprintvalue123456789ab';
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: `localrag_anonymous_id=${createAnonymousCookieValue(fingerprint)}`,
      },
    });

    const user = await getCurrentUser(request);

    expect(user).toEqual({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash(fingerprint),
    );
    expect(authMocks.setCookie).not.toHaveBeenCalled();
  });

  it('rejects a forged unsigned 32-character anonymous cookie and replaces it', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: 'localrag_anonymous_id=knownfingerprintvalue123456789ab',
      },
    });

    const user = await getCurrentUser(request);

    expect(user).toEqual({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash('0123456789abcdefghijklmnopqrstuv'),
    );
    expect(authMocks.setCookie).toHaveBeenCalledWith(
      'localrag_anonymous_id',
      createAnonymousCookieValue('0123456789abcdefghijklmnopqrstuv'),
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      }),
    );
  });

  it('creates and stores a new anonymous fingerprint when the request has no cookie', async () => {
    const request = new Request('https://app.example.com/api/settings');

    await getCurrentUser(request);

    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash('0123456789abcdefghijklmnopqrstuv'),
    );
    expect(authMocks.setCookie).toHaveBeenCalledWith(
      'localrag_anonymous_id',
      createAnonymousCookieValue('0123456789abcdefghijklmnopqrstuv'),
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      }),
    );
  });

  it('replaces a blank anonymous cookie with a fresh identifier', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: 'localrag_anonymous_id=',
      },
    });

    await getCurrentUser(request);

    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash('0123456789abcdefghijklmnopqrstuv'),
    );
    expect(authMocks.setCookie).toHaveBeenCalledWith(
      'localrag_anonymous_id',
      createAnonymousCookieValue('0123456789abcdefghijklmnopqrstuv'),
      expect.any(Object),
    );
  });

  it('replaces an invalid signed anonymous cookie instead of trusting it', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: 'localrag_anonymous_id=knownfingerprintvalue123456789ab.invalidsignature',
      },
    });

    await getCurrentUser(request);

    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash('0123456789abcdefghijklmnopqrstuv'),
    );
    expect(authMocks.setCookie).toHaveBeenCalledWith(
      'localrag_anonymous_id',
      createAnonymousCookieValue('0123456789abcdefghijklmnopqrstuv'),
      expect.any(Object),
    );
  });

  it('verifies the signature of anonymous cookies', () => {
    const fingerprint = 'knownfingerprintvalue123456789ab';

    expect(verifyAnonymousCookieValue(createAnonymousCookieValue(fingerprint))).toBe(fingerprint);
    expect(verifyAnonymousCookieValue(`${fingerprint}.invalidsignature`)).toBeUndefined();
  });
});
