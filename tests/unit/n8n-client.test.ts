import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const loggerErrorMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock('@/lib/logger/logger', () => ({
  logger: {
    child: () => ({
      warn: loggerWarnMock,
      error: loggerErrorMock,
    }),
  },
}));

import { N8nIngestionService } from '@/lib/n8n/ingestion';
import { N8nClient } from '@/lib/n8n/client';
import { N8nError } from '@/lib/n8n/errors';
import { N8nWorkflowService } from '@/lib/n8n/workflow';

describe('N8nClient', () => {
  beforeEach(() => {
    loggerErrorMock.mockClear();
    loggerWarnMock.mockClear();
  });

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
    expect(fetchMock.mock.calls[0][1].headers['x-n8n-webhook-secret']).toBeUndefined();
  });

  it('preserves base path prefixes when resolving request urls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));

    const client = new N8nClient({
      baseUrl: 'http://n8n.local/n8n',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 0,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.get('/healthz')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://n8n.local/n8n/healthz',
      expect.objectContaining({
        method: 'GET',
      }),
    );
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

  it('retries transport failures before succeeding', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 1,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.get('/api/v1/health')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries abort style failures and surfaces N8nError after attempts', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException('The operation was aborted.', 'AbortError'),
    );

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 1,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.get('/api/v1/health')).rejects.toBeInstanceOf(N8nError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not log raw upstream response bodies on final failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'secret chunk text' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      timeoutMs: 1000,
      retryCount: 0,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.get('/api/v1/health', { requestId: 'req_123' })).rejects.toBeInstanceOf(N8nError);

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/health',
        requestId: 'req_123',
        status: 502,
        attempt: 1,
        circuitOpen: false,
      }),
      'n8n request failed.',
    );
    expect(JSON.stringify(loggerErrorMock.mock.calls[0][0])).not.toContain('secret chunk text');
    expect(JSON.stringify(loggerErrorMock.mock.calls[0][0])).not.toContain('body');
  });

  it('fetches and combines all active workflow pages', async () => {
    const client = {
      get: vi
        .fn()
        .mockResolvedValueOnce({
          data: [
            { id: 'wf_1', name: 'Workflow 1', active: true, tags: [] },
            { id: 'wf_2', name: 'Workflow 2', active: true, tags: [] },
          ],
          nextCursor: 'cursor_2',
        })
        .mockResolvedValueOnce({
          data: [{ id: 'wf_3', name: 'Workflow 3', active: true, tags: [] }],
          nextCursor: null,
        }),
    };

    const service = new N8nWorkflowService(client as never);

    await expect(service.listActiveWorkflows('req_456')).resolves.toEqual([
      { id: 'wf_1', name: 'Workflow 1', active: true, tags: [] },
      { id: 'wf_2', name: 'Workflow 2', active: true, tags: [] },
      { id: 'wf_3', name: 'Workflow 3', active: true, tags: [] },
    ]);
    expect(client.get).toHaveBeenCalledTimes(2);
    expect(client.get).toHaveBeenNthCalledWith(1, '/api/v1/workflows', {
      query: { active: 'true', cursor: undefined },
      requestId: 'req_456',
      schema: expect.any(Object),
    });
    expect(client.get).toHaveBeenNthCalledWith(2, '/api/v1/workflows', {
      query: { active: 'true', cursor: 'cursor_2' },
      requestId: 'req_456',
      schema: expect.any(Object),
    });
  });

  it('starts document ingestion on the ingestion webhook path', async () => {
    const client = {
      post: vi.fn().mockResolvedValue({
        executionId: 'exec_123',
        workflowId: 'workflow_123',
      }),
    };

    const service = new N8nIngestionService(client as never);

    await expect(
      service.startDocumentIngestion({
        documentId: 'doc_1',
        uploadId: 'upload_1',
        filePath: 'uploads/doc.pdf',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
      }),
    ).resolves.toMatchObject({
      executionId: 'exec_123',
      workflowId: 'workflow_123',
    });
    expect(client.post).toHaveBeenCalledWith('/webhook/ingestion', {
      body: {
        documentId: 'doc_1',
        uploadId: 'upload_1',
        filePath: 'uploads/doc.pdf',
        fileName: 'doc.pdf',
        mimeType: 'application/pdf',
      },
      requestId: undefined,
      schema: expect.any(Object),
    });
  });

  it('adds the internal webhook secret header for workflow webhook requests only', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    const client = new N8nClient({
      baseUrl: 'http://n8n:5678',
      apiKey: 'secret',
      webhookSecret: 'internal-secret',
      timeoutMs: 1000,
      retryCount: 0,
      retryDelayMs: 1,
      fetchFn: fetchMock,
    });

    await expect(client.post('/webhook/retrieval', { body: { query: 'hello' } })).resolves.toEqual({ ok: true });
    await expect(client.get('/api/v1/health')).resolves.toEqual({ ok: true });

    expect(fetchMock.mock.calls[0][1].headers['x-n8n-webhook-secret']).toBe('internal-secret');
    expect(fetchMock.mock.calls[1][1].headers['x-n8n-webhook-secret']).toBeUndefined();
  });
});
