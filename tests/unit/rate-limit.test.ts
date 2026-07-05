import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rateLimit } from '@/lib/security/rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the configured window', async () => {
    vi.setSystemTime(new Date('2026-07-05T00:00:00.000Z'));

    const policy = { limit: 2, windowMs: 1_000 };

    await expect(rateLimit('ip-1', policy)).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
      resetAt: new Date('2026-07-05T00:00:01.000Z'),
    });
    await expect(rateLimit('ip-1', policy)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
      resetAt: new Date('2026-07-05T00:00:01.000Z'),
    });
    await expect(rateLimit('ip-1', policy)).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-07-05T00:00:01.000Z'),
    });
  });

  it('resets after the window expires', async () => {
    const policy = { limit: 1, windowMs: 1_000 };

    vi.setSystemTime(new Date('2026-07-05T00:00:00.000Z'));
    await rateLimit('ip-2', policy);

    vi.setSystemTime(new Date('2026-07-05T00:00:01.500Z'));
    await expect(rateLimit('ip-2', policy)).resolves.toMatchObject({
      allowed: true,
      remaining: 0,
      resetAt: new Date('2026-07-05T00:00:02.500Z'),
    });
  });
});
