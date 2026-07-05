import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger/logger', () => ({
  logger: {
    child: () => ({
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { N8nClient } from '@/lib/n8n/client';
import { N8nError } from '@/lib/n8n/errors';

describe('N8nClient', () => {
  it('adds API key auth, request id, and retries transient failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 1,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.get('/api/v1/health', { requestId: 'req_123' })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['X-N8N-API-KEY']).toBe('secret');
    expect(fetchMock.mock.calls[0][1].headers['x-request-id']).toBe('req_123');
  });

  it('does not retry successful responses with invalid json bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 2,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.post('/webhook/retrieval', { body: { query: 'hello' } })).rejects.toBeInstanceOf(N8nError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
