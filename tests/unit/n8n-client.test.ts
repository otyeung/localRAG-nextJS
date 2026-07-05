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

import { N8nIngestionService } from '@/lib/n8n/ingestion';
import { N8nClient } from '@/lib/n8n/client';
import { N8nError } from '@/lib/n8n/errors';
import { N8nWorkflowService } from '@/lib/n8n/workflow';

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
});
