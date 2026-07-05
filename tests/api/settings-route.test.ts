import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getForUser: vi.fn(),
  updateForUserWithAudit: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: routeMocks.getCurrentUser,
}));

vi.mock('@/lib/services/settings-service', () => ({
  SettingsService: class {
    getForUser = routeMocks.getForUser;
    updateForUserWithAudit = routeMocks.updateForUserWithAudit;
  },
  defaultUserSettings: {
    theme: 'system',
    model: 'gpt-4.1-mini',
    showReasoningMetadata: true,
  },
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: routeMocks.rateLimit,
}));

import { GET, PATCH } from '@/app/api/settings/route';

describe('settings route', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.getForUser.mockResolvedValue({
      theme: 'system',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: true,
    });
    routeMocks.updateForUserWithAudit.mockResolvedValue({
      theme: 'dark',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: false,
    });
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  });

  it('returns the current user settings', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        'x-request-id': 'req_get',
        'user-agent': 'vitest',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        theme: 'system',
        model: 'gpt-4.1-mini',
        showReasoningMetadata: true,
      },
    });
    expect(routeMocks.getCurrentUser).toHaveBeenCalledWith(request);
    expect(routeMocks.getForUser).toHaveBeenCalledWith('user_1');
    expect(routeMocks.rateLimit).toHaveBeenCalledWith(
      'settings:get:user_1:unknown',
      expect.objectContaining({
        namespace: 'settings-api',
      }),
    );
  });

  it('updates settings atomically with an audit event', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'user-agent': 'vitest',
        'x-request-id': 'req_patch',
      },
      body: JSON.stringify({
        theme: 'dark',
        showReasoningMetadata: false,
      }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        theme: 'dark',
        model: 'gpt-4.1-mini',
        showReasoningMetadata: false,
      },
    });
    expect(routeMocks.updateForUserWithAudit).toHaveBeenCalledWith(
      'user_1',
      {
        theme: 'dark',
        showReasoningMetadata: false,
      },
      {
        requestId: 'req_patch',
        ipAddress: 'unknown',
        userAgent: 'vitest',
      },
    );
    expect(routeMocks.rateLimit).toHaveBeenCalledWith(
      'settings:patch:user_1:unknown',
      expect.objectContaining({
        namespace: 'settings-api',
      }),
    );
  });

  it('rejects cross-origin settings updates', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        host: 'app.example.com',
        origin: 'https://evil.example.com',
        'x-request-id': 'req_forbidden',
      },
      body: JSON.stringify({ theme: 'dark' }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'FORBIDDEN',
        message: 'Cross-origin mutation rejected.',
        requestId: 'req_forbidden',
      },
    });
  });

  it('rate limits settings requests', async () => {
    routeMocks.rateLimit.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        'x-request-id': 'req_limited',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many settings requests.',
        requestId: 'req_limited',
      },
    });
  });
});
