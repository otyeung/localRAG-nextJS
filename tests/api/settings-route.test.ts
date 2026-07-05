import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createAnonymousCookieValue } from '@/lib/auth/anonymous-provider';

const originalTrustProxyHeaders = process.env.TRUST_PROXY_HEADERS;
const mutableProcessEnv = process.env as NodeJS.ProcessEnv & { TRUST_PROXY_HEADERS?: string };

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
    mutableProcessEnv.TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    routeMocks.getCurrentUser.mockReset();
    routeMocks.getForUser.mockReset();
    routeMocks.updateForUserWithAudit.mockReset();
    routeMocks.rateLimit.mockReset();
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
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      2,
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
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      2,
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
    expect(routeMocks.getCurrentUser).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many settings requests.',
        requestId: 'req_limited',
      },
    });
    expect(routeMocks.rateLimit).toHaveBeenCalledWith(
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
  });

  it('does not use the low 30/min pre-auth bucket for unknown-ip requests without a valid cookie', async () => {
    const firstRequest = new Request('https://app.example.com/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en-US',
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'sec-ch-ua': '"Chromium";v="126"',
        'sec-ch-ua-platform': '"macOS"',
        'user-agent': 'browser-a',
        'x-request-id': 'req_pre_auth_first',
      },
      body: JSON.stringify({ theme: 'dark' }),
    });
    const secondRequest = new Request('https://app.example.com/api/settings', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'accept-language': 'en-US',
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'sec-ch-ua': '"Chromium";v="126"',
        'sec-ch-ua-platform': '"macOS"',
        'user-agent': 'browser-a',
        'x-request-id': 'req_pre_auth_second',
      },
      body: JSON.stringify({ theme: 'dark' }),
    });

    const firstResponse = await PATCH(firstRequest);
    const secondResponse = await PATCH(secondRequest);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(routeMocks.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(routeMocks.updateForUserWithAudit).toHaveBeenCalledTimes(2);
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      3,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(
      routeMocks.rateLimit.mock.calls.filter(([, policy]) => policy?.namespace === 'settings-api-pre-auth'),
    ).toHaveLength(0);
  });

  it('uses a signed anonymous cookie for the pre-provision rate-limit key', async () => {
    const fingerprint = 'knownfingerprintvalue123456789ab';
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: `localrag_anonymous_id=${createAnonymousCookieValue(fingerprint)}`,
        'x-request-id': 'req_signed_cookie',
        'user-agent': 'vitest',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      `settings:pre:get:cookie:${fingerprint}`,
      expect.objectContaining({
        namespace: 'settings-api-pre-auth',
      }),
    );
    expect(routeMocks.rateLimit).toHaveBeenCalledTimes(2);
  });

  it('does not trust a forged unsigned 32-character cookie for the pre-provision rate-limit key', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: 'localrag_anonymous_id=knownfingerprintvalue123456789ab',
        'x-request-id': 'req_forged_cookie',
        'user-agent': 'vitest',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
  });

  it('does not trust an invalid signed cookie for the pre-provision rate-limit key', async () => {
    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        cookie: 'localrag_anonymous_id=knownfingerprintvalue123456789ab.invalidsignature',
        'x-request-id': 'req_invalid_signature',
        'user-agent': 'vitest',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
  });

  it('does not derive a low pre-auth bucket from common browser headers without a valid cookie', async () => {
    const firstRequest = new Request('https://app.example.com/api/settings', {
      headers: {
        'accept-language': 'en-US',
        'sec-ch-ua': '"Chromium";v="126"',
        'sec-ch-ua-platform': '"macOS"',
        'x-request-id': 'req_browser_a',
        'user-agent': 'browser-a',
      },
    });
    const secondRequest = new Request('https://app.example.com/api/settings', {
      headers: {
        'accept-language': 'en-GB',
        'sec-ch-ua': '"Chromium";v="126"',
        'sec-ch-ua-platform': '"Windows"',
        'x-request-id': 'req_browser_b',
        'user-agent': 'browser-b',
      },
    });

    const firstResponse = await GET(firstRequest);
    const secondResponse = await GET(secondRequest);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      3,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(
      routeMocks.rateLimit.mock.calls.filter(([, policy]) => policy?.namespace === 'settings-api-pre-auth'),
    ).toHaveLength(0);
  });

  it('uses the trusted client ip for the pre-provision rate-limit key when proxy headers are enabled', async () => {
    mutableProcessEnv.TRUST_PROXY_HEADERS = 'true';

    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        'x-forwarded-for': '203.0.113.10, 10.0.0.5',
        'x-request-id': 'req_trusted_ip',
        'user-agent': 'browser-a',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:get:ip:203.0.113.10',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth',
      }),
    );
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      2,
      'settings:get:user_1:203.0.113.10',
      expect.objectContaining({
        namespace: 'settings-api',
      }),
    );
  });

  it('can hit the higher-cap global new-anonymous safety bucket without sharing one tiny low bucket', async () => {
    routeMocks.rateLimit.mockImplementation(async (_key: string, policy: { namespace?: string }) => ({
      allowed: policy.namespace !== 'settings-api-pre-auth-new-anonymous',
      remaining: 0,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    }));

    const request = new Request('https://app.example.com/api/settings', {
      headers: {
        'accept-language': 'en-US',
        'sec-ch-ua': '"Chromium";v="126"',
        'sec-ch-ua-platform': '"macOS"',
        'user-agent': 'browser-a',
        'x-request-id': 'req_global_safety_limited',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(429);
    expect(routeMocks.getCurrentUser).not.toHaveBeenCalled();
    expect(routeMocks.rateLimit).toHaveBeenNthCalledWith(
      1,
      'settings:pre:new-anonymous:global',
      expect.objectContaining({
        namespace: 'settings-api-pre-auth-new-anonymous',
      }),
    );
    expect(
      routeMocks.rateLimit.mock.calls.filter(([, policy]) => policy?.namespace === 'settings-api-pre-auth'),
    ).toHaveLength(0);
  });
});
