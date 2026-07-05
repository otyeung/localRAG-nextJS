import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { HealthService } from '@/lib/services/health-service';

describe('HealthService', () => {
  it('reports component health without secret values', async () => {
    const service = new HealthService({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      getUptimeSeconds: () => 321,
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      getN8nStatus: vi.fn().mockResolvedValue({
        healthy: true,
        workflowCount: 2,
      }),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      isOpenAiConfigured: () => true,
      getOpenAiModel: () => 'gpt-4.1-mini',
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health).toMatchObject({
      status: 'healthy',
      checkedAt: '2026-01-01T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 321,
    });
    expect(health.checks.map((check) => check.name)).toEqual(['app', 'database', 'n8n', 'qdrant', 'openai']);
    expect(health.checks.every((check) => check.status === 'healthy')).toBe(true);
    expect(JSON.stringify(health)).not.toContain('sk-');
  });

  it('marks critical dependencies unhealthy and non-critical dependencies degraded', async () => {
    const service = new HealthService({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      getUptimeSeconds: () => 12,
      checkDatabase: vi.fn().mockRejectedValue(new Error('postgresql://secret-host/db')),
      getN8nStatus: vi.fn().mockRejectedValue(new Error('n8n down')),
      checkQdrantCollection: vi.fn().mockResolvedValue(false),
      isOpenAiConfigured: () => false,
      getOpenAiModel: () => '',
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.status).toBe('unhealthy');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'database', status: 'unhealthy' }),
        expect.objectContaining({ name: 'n8n', status: 'degraded' }),
        expect.objectContaining({ name: 'qdrant', status: 'degraded' }),
        expect.objectContaining({ name: 'openai', status: 'degraded' }),
      ]),
    );
    expect(JSON.stringify(health)).not.toContain('postgresql://secret-host/db');
  });
});
