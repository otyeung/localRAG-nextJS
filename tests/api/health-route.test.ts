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

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/health/route');
}

describe('health route', () => {
  beforeEach(() => {
    routeMocks.getHealth.mockReset();
    vi.unstubAllEnvs();
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

    const { GET } = await loadRoute();
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

    const { GET } = await loadRoute();
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

  it('can be imported and called when non-health env vars are missing', async () => {
    vi.stubEnv('LOG_LEVEL', 'warn');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('N8N_BASE_URL', '');
    vi.stubEnv('N8N_API_KEY', '');
    vi.stubEnv('QDRANT_URL', '');
    vi.stubEnv('QDRANT_COLLECTION', '');

    routeMocks.getHealth.mockResolvedValue({
      status: 'healthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 42,
      checks: [
        {
          name: 'app',
          status: 'healthy',
          message: 'Running version 0.1.0 with 42s uptime.',
          checkedAt: '2026-01-01T00:00:00.000Z',
          latencyMs: 1,
        },
      ],
    });

    const { GET } = await loadRoute();
    const response = await GET(new Request('https://app.example.com/api/health'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        status: 'healthy',
        checks: [
          {
            name: 'app',
          },
        ],
      },
    });
  });
});
