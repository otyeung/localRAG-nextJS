import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getDockerFleetHealth: vi.fn(),
}));

vi.mock('@/lib/services/health-service', () => ({
  HealthService: class {
    getDockerFleetHealth = routeMocks.getDockerFleetHealth;
  },
}));

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/health/fleet/route');
}

describe('docker fleet health route', () => {
  beforeEach(() => {
    routeMocks.getDockerFleetHealth.mockReset();
  });

  it('returns 200 when all Docker fleet services are healthy', async () => {
    routeMocks.getDockerFleetHealth.mockResolvedValue({
      status: 'healthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
      services: [
        {
          name: 'nextjs',
          status: 'healthy',
          message: 'Next.js is running.',
          checkedAt: '2026-01-01T00:00:00.000Z',
          latencyMs: 1,
        },
      ],
    });

    const { GET } = await loadRoute();
    const response = await GET(
      new Request('https://app.example.com/api/health/fleet'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: 'healthy',
        services: [
          {
            name: 'nextjs',
            status: 'healthy',
          },
        ],
      },
    });
  });

  it('returns 503 when any Docker fleet service is unhealthy', async () => {
    routeMocks.getDockerFleetHealth.mockResolvedValue({
      status: 'unhealthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
      services: [
        {
          name: 'redis',
          status: 'unhealthy',
          message: 'Redis connection failed.',
          checkedAt: '2026-01-01T00:00:00.000Z',
          latencyMs: 1,
        },
      ],
    });

    const { GET } = await loadRoute();
    const response = await GET(
      new Request('https://app.example.com/api/health/fleet'),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: 'unhealthy',
      },
    });
  });
});
