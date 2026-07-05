import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { HealthService } from '@/lib/services/health-service';

const requiredEnvEntries = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost:5432/localrag_nextjs',
  N8N_BASE_URL: 'https://n8n.example.com',
  N8N_API_KEY: 'n8n-test',
  N8N_RETRY_COUNT: '3',
  N8N_RETRY_DELAY: '1',
  OPENAI_API_KEY: 'sk-test',
  OPENAI_MODEL: 'gpt-4.1-mini',
  QDRANT_URL: 'http://qdrant.example.com:6333',
  QDRANT_COLLECTION: 'documents',
  ANONYMOUS_COOKIE_SECRET: 'localrag-nextjs-test-anonymous-cookie-secret',
} as const;

async function loadHealthService() {
  vi.resetModules();
  const module = await import('@/lib/services/health-service');
  return module.HealthService;
}

function applyRequiredEnv(overrides: Partial<Record<keyof typeof requiredEnvEntries, string>>) {
  for (const [key, value] of Object.entries({ ...requiredEnvEntries, ...overrides })) {
    vi.stubEnv(key, value);
  }
}

describe('HealthService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

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

  it('treats missing OpenAI and Qdrant configuration as degraded without throwing', async () => {
    const service = new HealthService({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      getUptimeSeconds: () => 12,
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      getN8nStatus: vi.fn().mockResolvedValue({
        healthy: true,
        workflowCount: 1,
      }),
      checkQdrantCollection: vi.fn().mockResolvedValue(false),
      isOpenAiConfigured: vi.fn().mockRejectedValue(new Error('missing OPENAI_API_KEY')),
      getOpenAiModel: vi.fn().mockRejectedValue(new Error('missing OPENAI_MODEL')),
      getQdrantCollection: vi.fn().mockRejectedValue(new Error('missing QDRANT_COLLECTION')),
    });

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qdrant',
          status: 'degraded',
          message: 'Qdrant configuration or connectivity is unavailable.',
        }),
        expect.objectContaining({
          name: 'openai',
          status: 'degraded',
          message: 'OpenAI configuration is incomplete.',
        }),
      ]),
    );
    expect(JSON.stringify(health)).not.toContain('missing OPENAI_API_KEY');
    expect(JSON.stringify(health)).not.toContain('missing QDRANT_COLLECTION');
  });

  it('recovers when qdrant dependency functions throw', async () => {
    const service = new HealthService({
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      getUptimeSeconds: () => 12,
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      getN8nStatus: vi.fn().mockResolvedValue({
        healthy: true,
        workflowCount: 1,
      }),
      checkQdrantCollection: vi.fn().mockRejectedValue(new Error('qdrant ping failed')),
      isOpenAiConfigured: () => true,
      getOpenAiModel: () => 'gpt-4.1-mini',
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qdrant',
          status: 'degraded',
          message: 'Qdrant configuration or connectivity is unavailable.',
        }),
      ]),
    );
    expect(JSON.stringify(health)).not.toContain('qdrant ping failed');
  });

  it('keeps n8n healthy when OpenAI env is missing', async () => {
    applyRequiredEnv({
      OPENAI_API_KEY: '',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://n8n.example.com/healthz') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://n8n.example.com/api/v1/workflows?active=true') {
        return new Response(JSON.stringify({ data: [{ id: 'wf_1', name: 'Ingestion', active: true }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'healthy',
          message: 'n8n is healthy with 1 active workflows.',
        }),
        expect.objectContaining({
          name: 'openai',
          status: 'degraded',
          message: 'OpenAI configuration is incomplete.',
        }),
      ]),
    );
  });

  it('preserves n8n base path prefixes when checking healthz', async () => {
    applyRequiredEnv({
      N8N_BASE_URL: 'https://n8n.example.com/n8n',
    });

    const requestedUrls: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      requestedUrls.push(url);

      if (url === 'https://n8n.example.com/n8n/healthz') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://n8n.example.com/n8n/api/v1/workflows?active=true') {
        return new Response(JSON.stringify({ data: [{ id: 'wf_1', name: 'Ingestion', active: true }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      isOpenAiConfigured: () => true,
      getOpenAiModel: () => 'gpt-4.1-mini',
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'healthy',
          message: 'n8n is healthy with 1 active workflows.',
        }),
      ]),
    );
    expect(requestedUrls).toEqual([
      'https://n8n.example.com/n8n/healthz',
      'https://n8n.example.com/n8n/api/v1/workflows?active=true',
    ]);
  });

  it('treats blank OpenAI model and Qdrant collection values as degraded config', async () => {
    applyRequiredEnv({
      OPENAI_MODEL: '',
      QDRANT_COLLECTION: '',
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      getN8nStatus: vi.fn().mockResolvedValue({
        healthy: true,
        workflowCount: 1,
      }),
    });

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'openai',
          status: 'degraded',
          message: 'OpenAI configuration is incomplete.',
        }),
        expect.objectContaining({
          name: 'qdrant',
          status: 'degraded',
          message: 'Qdrant configuration or connectivity is unavailable.',
        }),
      ]),
    );
    expect(JSON.stringify(health)).not.toContain('gpt-4.1-mini');
    expect(JSON.stringify(health)).not.toContain('documents');
  });

  it('keeps OpenAI healthy when n8n env is missing', async () => {
    applyRequiredEnv({
      N8N_API_KEY: '',
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      getN8nStatus: vi.fn().mockResolvedValue({
        healthy: false,
        workflowCount: 0,
      }),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'degraded',
          message:
            'n8n REST API key is not configured; webhook-only mode is active and API-backed status checks remain unavailable until an administrator provisions a key outside this stack.',
        }),
        expect.objectContaining({
          name: 'openai',
          status: 'healthy',
          message: 'OpenAI model "gpt-4.1-mini" is configured.',
        }),
      ]),
    );
  });

  it('reports manual action required when the n8n api key is missing', async () => {
    applyRequiredEnv({
      N8N_API_KEY: '',
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'degraded',
          message:
            'n8n REST API key is not configured; webhook-only mode is active and API-backed status checks remain unavailable until an administrator provisions a key outside this stack.',
        }),
      ]),
    );
  });

  it('does not retry non-retryable 401 responses from n8n', async () => {
    applyRequiredEnv({
      N8N_RETRY_COUNT: '3',
      N8N_RETRY_DELAY: '1',
    });

    let healthzCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://n8n.example.com/healthz') {
        healthzCalls += 1;
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://n8n.example.com/api/v1/workflows?active=true') {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'degraded',
          message: 'n8n API unavailable or workflows could not be listed.',
        }),
      ]),
    );
    expect(healthzCalls).toBe(1);
  });

  it('does not retry non-retryable 404 responses from n8n', async () => {
    applyRequiredEnv({
      N8N_RETRY_COUNT: '3',
      N8N_RETRY_DELAY: '1',
    });

    let healthzCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://n8n.example.com/healthz') {
        healthzCalls += 1;
        return new Response(JSON.stringify({ message: 'Not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://n8n.example.com/api/v1/workflows?active=true') {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'degraded',
          message: 'n8n API unavailable or workflows could not be listed.',
        }),
      ]),
    );
    expect(healthzCalls).toBe(1);
  });

  it('retries retryable 5xx responses from n8n', async () => {
    applyRequiredEnv({
      N8N_RETRY_COUNT: '2',
      N8N_RETRY_DELAY: '1',
    });

    let healthzCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      if (url === 'https://n8n.example.com/healthz') {
        healthzCalls += 1;
        if (healthzCalls < 3) {
          return new Response(JSON.stringify({ message: 'Server error' }), {
            status: 500,
            headers: { 'content-type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ status: 'ok' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url === 'https://n8n.example.com/api/v1/workflows?active=true') {
        return new Response(JSON.stringify({ data: [{ id: 'wf_1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      checkQdrantCollection: vi.fn().mockResolvedValue(true),
      getQdrantCollection: () => 'documents',
    });

    const health = await service.getHealth();

    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'n8n',
          status: 'healthy',
          message: 'n8n is healthy with 1 active workflows.',
        }),
      ]),
    );
    expect(healthzCalls).toBe(3);
  });

  it('isolates a missing Qdrant URL to the Qdrant check', async () => {
    applyRequiredEnv({
      QDRANT_URL: '',
    });

    const LoadedHealthService = await loadHealthService();
    const service = new LoadedHealthService({
      checkDatabase: vi.fn().mockResolvedValue(undefined),
      getN8nStatus: vi.fn().mockResolvedValue({
        healthy: true,
        workflowCount: 1,
      }),
    });

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'qdrant',
          status: 'degraded',
          message: 'Qdrant configuration or connectivity is unavailable.',
        }),
        expect.objectContaining({
          name: 'openai',
          status: 'healthy',
          message: 'OpenAI model "gpt-4.1-mini" is configured.',
        }),
        expect.objectContaining({
          name: 'n8n',
          status: 'healthy',
          message: 'n8n is healthy with 1 active workflows.',
        }),
      ]),
    );
  });
});
