import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  completeIngestion: vi.fn(),
}));

vi.mock('@/lib/services/ingestion-callback-service', () => ({
  IngestionCallbackService: class {
    completeIngestion = routeMocks.completeIngestion;
  },
}));

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/ingestion/callback/route');
}

describe('ingestion callback route', () => {
  beforeEach(() => {
    routeMocks.completeIngestion.mockReset();
    routeMocks.completeIngestion.mockResolvedValue({
      documentId: 'document_1',
      uploadId: 'upload_1',
      workflowExecutionId: 'workflow_1',
      status: 'READY',
      chunkCount: 1,
    });
  });

  it('accepts n8n completion callbacks authenticated with the webhook secret', async () => {
    const { POST } = await loadRoute();
    const request = new Request('https://app.example.com/api/ingestion/callback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_callback',
        'x-n8n-webhook-secret': 'localrag-nextjs-test-webhook-secret',
      },
      body: JSON.stringify({
        documentId: 'document_1',
        uploadId: 'upload_1',
        externalExecutionId: '22',
        workflowId: 'workflow-ingestion',
        embeddingModel: 'nomic-embed-text',
        chunks: [
          {
            chunkIndex: 0,
            content: 'Chunk content.',
            tokenCount: 3,
            pointId: 'point_1',
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        documentId: 'document_1',
        uploadId: 'upload_1',
        workflowExecutionId: 'workflow_1',
        status: 'READY',
        chunkCount: 1,
      },
    });
    expect(routeMocks.completeIngestion).toHaveBeenCalledWith({
      documentId: 'document_1',
      uploadId: 'upload_1',
      externalExecutionId: '22',
      workflowId: 'workflow-ingestion',
      embeddingModel: 'nomic-embed-text',
      chunks: [
        {
          chunkIndex: 0,
          content: 'Chunk content.',
          tokenCount: 3,
          pointId: 'point_1',
        },
      ],
    });
  });

  it('rejects callbacks that do not include the internal webhook secret', async () => {
    const { POST } = await loadRoute();
    const request = new Request('https://app.example.com/api/ingestion/callback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_forbidden',
      },
      body: JSON.stringify({
        documentId: 'document_1',
        uploadId: 'upload_1',
        chunks: [{ chunkIndex: 0, content: 'Chunk content.' }],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid n8n webhook secret.',
        requestId: 'req_forbidden',
      },
    });
    expect(routeMocks.completeIngestion).not.toHaveBeenCalled();
  });

  it('returns structured validation errors for duplicate chunk indexes', async () => {
    const { POST } = await loadRoute();
    const request = new Request('https://app.example.com/api/ingestion/callback', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_invalid',
        'x-n8n-webhook-secret': 'localrag-nextjs-test-webhook-secret',
      },
      body: JSON.stringify({
        documentId: 'document_1',
        uploadId: 'upload_1',
        chunks: [
          { chunkIndex: 0, content: 'Chunk content.' },
          { chunkIndex: 0, content: 'Duplicate chunk content.' },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid ingestion callback payload.',
        requestId: 'req_invalid',
      },
    });
    expect(routeMocks.completeIngestion).not.toHaveBeenCalled();
  });
});
