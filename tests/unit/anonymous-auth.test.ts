import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  setCookie: vi.fn(),
  findOrCreateAnonymousUser: vi.fn(),
}));

vi.mock('server-only', () => ({}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    set: authMocks.setCookie,
  })),
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'generated-fingerprint'),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));

vi.mock('@/lib/repositories/user-repository', () => ({
  UserRepository: class {
    findOrCreateAnonymousUser = authMocks.findOrCreateAnonymousUser;
  },
}));

import { createAnonymousFingerprintHash } from '@/lib/auth/anonymous-provider';
import { getCurrentUser } from '@/lib/auth/current-user';

describe('anonymous auth provider', () => {
  beforeEach(() => {
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

  it('reuses the anonymous cookie when the request already has one', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: 'localrag_anonymous_id=known-fingerprint',
      },
    });

    const user = await getCurrentUser(request);

    expect(user).toEqual({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash('known-fingerprint'),
    );
    expect(authMocks.setCookie).not.toHaveBeenCalled();
  });

  it('creates and stores a new anonymous fingerprint when the request has no cookie', async () => {
    const request = new Request('https://app.example.com/api/settings');

    await getCurrentUser(request);

    expect(authMocks.findOrCreateAnonymousUser).toHaveBeenCalledWith(
      await createAnonymousFingerprintHash('generated-fingerprint'),
    );
    expect(authMocks.setCookie).toHaveBeenCalledWith(
      'localrag_anonymous_id',
      'generated-fingerprint',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
      }),
    );
  });
});
