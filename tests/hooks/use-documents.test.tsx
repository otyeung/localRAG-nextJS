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
});
