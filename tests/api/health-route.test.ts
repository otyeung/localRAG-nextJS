import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
}));

vi.mock('@/lib/services/health-service', () => ({
  HealthService: class {
    getHealth = routeMocks.getHealth;
  },
}));

import { GET } from '@/app/api/health/route';

describe('health route', () => {
  beforeEach(() => {
    routeMocks.getHealth.mockReset();
  });

  it('returns 200 for degraded health snapshots', async () => {
    routeMocks.getHealth.mockResolvedValue({
      status: 'degraded',
      checkedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 42,
      checks: [
        {
          name: 'app',
          status: 'healthy',
          message: 'Running version 0.1.0.',
          checkedAt: '2026-01-01T00:00:00.000Z',
          latencyMs: 1,
        },
      ],
    });

    const response = await GET(
      new Request('https://app.example.com/api/health', {
        headers: {
          'x-request-id': 'req_health_ok',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: 'degraded',
      },
    });
  });

  it('returns 503 for unhealthy health snapshots', async () => {
    routeMocks.getHealth.mockResolvedValue({
      status: 'unhealthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 42,
      checks: [
        {
          name: 'database',
          status: 'unhealthy',
          message: 'Database query failed.',
          checkedAt: '2026-01-01T00:00:00.000Z',
          latencyMs: 4,
        },
      ],
    });

    const response = await GET(
      new Request('https://app.example.com/api/health', {
        headers: {
          'x-request-id': 'req_health_fail',
        },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: 'unhealthy',
      },
    });
  });
});
