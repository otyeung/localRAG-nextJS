import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocuments } from '@/hooks/use-documents';

function createWrapper(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'DocumentsQueryClientWrapper';

  return Wrapper;
}

describe('useDocuments', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('re-indexes through the same-origin documents API and invalidates document/workflow queries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (typeof input === 'string' && input.startsWith('/api/documents?')) {
        return new Response(
          JSON.stringify({
            data: {
              items: [],
              total: 0,
              page: 1,
              pageSize: 20,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/workflows') {
        return new Response(
          JSON.stringify({
            data: {
              items: [],
              total: 0,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/documents/document_1' && init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            data: {
              workflowExecutionId: 'workflow_1',
              externalExecutionId: 'n8n_1',
              status: 'RUNNING',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDocuments(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await result.current.reindexDocument.mutateAsync('document_1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/documents/document_1', { method: 'PATCH' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['documents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflows'] });
  });

  it('preserves the first workflow for each document when workflows are returned newest-first', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (typeof input === 'string' && input.startsWith('/api/documents?')) {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'document_1',
                  uploadId: 'upload_1',
                  status: 'READY',
                  title: 'Quarterly Report',
                  originalFilename: 'quarterly-report.pdf',
                  mimeType: 'application/pdf',
                  fileSizeBytes: 1024,
                  chunkCount: 12,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-02T00:00:00.000Z',
                  deletedAt: null,
                },
              ],
              total: 1,
              page: 1,
              pageSize: 20,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/workflows') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'workflow_newest',
                  workflowKey: 'ingestion',
                  status: 'RUNNING',
                  errorMessage: null,
                  createdAt: '2026-01-02T00:00:00.000Z',
                  updatedAt: '2026-01-02T00:00:30.000Z',
                  startedAt: '2026-01-02T00:00:00.000Z',
                  completedAt: null,
                  uploadId: 'upload_1',
                  documentId: 'document_1',
                  reconciliationRequired: false,
                },
                {
                  id: 'workflow_older',
                  workflowKey: 'ingestion',
                  status: 'ERROR',
                  errorMessage: 'Older workflow should not win.',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:30.000Z',
                  startedAt: '2026-01-01T00:00:00.000Z',
                  completedAt: '2026-01-01T00:10:00.000Z',
                  uploadId: 'upload_1',
                  documentId: 'document_1',
                  reconciliationRequired: false,
                },
              ],
              total: 2,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const { result } = renderHook(() => useDocuments(), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.documents[0]).toMatchObject({
      id: 'document_1',
      chunkCount: 12,
    });
    expect(result.current.workflowsByDocumentId.get('document_1')).toMatchObject({
      id: 'workflow_newest',
      status: 'RUNNING',
    });
  });
});
