import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDocuments } from '@/hooks/use-documents';

function createWrapper(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'DocumentsQueryClientWrapper';

  return Wrapper;
}

function createDocument(index: number) {
  return {
    id: `document_${index}`,
    uploadId: `upload_${index}`,
    status: 'READY' as const,
    title: `Document ${index}`,
    originalFilename: `document-${index}.pdf`,
    mimeType: 'application/pdf',
    fileSizeBytes: 1024 + index,
    chunkCount: index,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    deletedAt: null,
  };
}

function createWorkflowSearchParams(documentIds: string[]) {
  return new URLSearchParams([
    ...documentIds.map((documentId) => ['documentIds', documentId] as [string, string]),
    ['pageSize', String(documentIds.length)],
  ]).toString();
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

      if (input === '/api/workflows?documentIds=document_1&pageSize=1') {
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
              status: 'RUNNING',
              reconciliationRequired: false,
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
    await result.current.queueReindexDocument('document_1');

    expect(fetchSpy).toHaveBeenCalledWith('/api/documents/document_1', { method: 'PATCH' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['documents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflows'] });
  });

  it('invalidates document/workflow queries when re-index returns an error after workflow state may have changed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
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

      if (input === '/api/workflows?documentIds=document_1&pageSize=1') {
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
            error: {
              message: 'Document ingestion started, but local state reconciliation is required.',
            },
          }),
          { status: 500, headers: { 'content-type': 'application/json' } },
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

    await expect(result.current.queueReindexDocument('document_1')).rejects.toThrow(
      'Document ingestion started, but local state reconciliation is required.',
    );

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['documents'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflows'] });
  });

  it('prevents duplicate re-index submissions for the same document while allowing other documents to continue', async () => {
    let resolveDocumentOne: ((value: Response) => void) | undefined;
    let resolveDocumentTwo: ((value: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (input === '/api/documents?page=1&pageSize=20&sort=updatedAt&order=desc') {
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
                {
                  id: 'document_2',
                  uploadId: 'upload_2',
                  status: 'FAILED',
                  title: 'Vendor Checklist',
                  originalFilename: 'vendor-checklist.pdf',
                  mimeType: 'application/pdf',
                  fileSizeBytes: 2048,
                  chunkCount: 4,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-03T00:00:00.000Z',
                  deletedAt: null,
                },
              ],
              total: 2,
              page: 1,
              pageSize: 20,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/workflows?documentIds=document_1&documentIds=document_2&pageSize=2') {
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
        return new Promise<Response>((resolve) => {
          resolveDocumentOne = resolve;
        });
      }

      if (input === '/api/documents/document_2' && init?.method === 'PATCH') {
        return new Promise<Response>((resolve) => {
          resolveDocumentTwo = resolve;
        });
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

    let firstRequest: Promise<unknown> | undefined;
    await act(async () => {
      firstRequest = result.current.queueReindexDocument('document_1');
    });

    await waitFor(() =>
      expect(Array.from(result.current.pendingReindexDocumentIds).sort()).toEqual(['document_1']),
    );

    await expect(result.current.queueReindexDocument('document_1')).resolves.toBeNull();

    let secondRequest: Promise<unknown> | undefined;
    await act(async () => {
      secondRequest = result.current.queueReindexDocument('document_2');
    });

    await waitFor(() =>
      expect(Array.from(result.current.pendingReindexDocumentIds).sort()).toEqual(['document_1', 'document_2']),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(fetchSpy).toHaveBeenCalledWith('/api/documents/document_1', { method: 'PATCH' });
    expect(fetchSpy).toHaveBeenCalledWith('/api/documents/document_2', { method: 'PATCH' });

    resolveDocumentOne?.(
      new Response(
        JSON.stringify({
          data: {
            workflowExecutionId: 'workflow_1',
            status: 'RUNNING',
            reconciliationRequired: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    resolveDocumentTwo?.(
      new Response(
        JSON.stringify({
          data: {
            workflowExecutionId: 'workflow_2',
            status: 'RUNNING',
            reconciliationRequired: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(firstRequest).resolves.toMatchObject({ workflowExecutionId: 'workflow_1' });
    await expect(secondRequest).resolves.toMatchObject({ workflowExecutionId: 'workflow_2' });
    await waitFor(() => expect(Array.from(result.current.pendingReindexDocumentIds)).toEqual([]));
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

      if (input === '/api/workflows?documentIds=document_1&pageSize=1') {
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

  it('loads additional document pages and resets to page one when search changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/api/documents?page=1&pageSize=40&sort=updatedAt&order=desc') {
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
              total: 2,
              page: 1,
              pageSize: 40,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/documents?page=2&pageSize=40&sort=updatedAt&order=desc') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'document_2',
                  uploadId: 'upload_2',
                  status: 'FAILED',
                  title: 'Vendor Checklist',
                  originalFilename: 'vendor-checklist.pdf',
                  mimeType: 'application/pdf',
                  fileSizeBytes: 2048,
                  chunkCount: 4,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-03T00:00:00.000Z',
                  deletedAt: null,
                },
              ],
              total: 2,
              page: 2,
              pageSize: 40,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/documents?page=1&pageSize=40&sort=updatedAt&order=desc&query=vendor') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'document_vendor',
                  uploadId: 'upload_3',
                  status: 'READY',
                  title: 'Vendor Brief',
                  originalFilename: 'vendor-brief.pdf',
                  mimeType: 'application/pdf',
                  fileSizeBytes: 3072,
                  chunkCount: 8,
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-04T00:00:00.000Z',
                  deletedAt: null,
                },
              ],
              total: 1,
              page: 1,
              pageSize: 40,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/workflows?documentIds=document_1&pageSize=1') {
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

      if (input === '/api/workflows?documentIds=document_1&documentIds=document_2&pageSize=2') {
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

      if (input === '/api/workflows?documentIds=document_vendor&pageSize=1') {
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

      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const { result, rerender } = renderHook(({ search }) => useDocuments({ search, pageSize: 40 }), {
      initialProps: { search: '' },
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.documents).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.documents).toHaveLength(2));

    rerender({ search: 'vendor' });

    await waitFor(() =>
      expect(result.current.documents).toEqual([
        expect.objectContaining({
          id: 'document_vendor',
          title: 'Vendor Brief',
        }),
      ]),
    );

    expect(fetchSpy).toHaveBeenCalledWith('/api/documents?page=1&pageSize=40&sort=updatedAt&order=desc&query=vendor', undefined);
    expect(fetchSpy).toHaveBeenCalledWith('/api/workflows?documentIds=document_vendor&pageSize=1', undefined);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('batches workflow lookups into <=100 document ids after loading more than 100 documents', async () => {
    const firstPageDocuments = Array.from({ length: 100 }, (_, index) => createDocument(index + 1));
    const secondPageDocuments = Array.from({ length: 5 }, (_, index) => createDocument(index + 101));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/api/documents?page=1&pageSize=100&sort=updatedAt&order=desc') {
        return new Response(
          JSON.stringify({
            data: {
              items: firstPageDocuments,
              total: 105,
              page: 1,
              pageSize: 100,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/documents?page=2&pageSize=100&sort=updatedAt&order=desc') {
        return new Response(
          JSON.stringify({
            data: {
              items: secondPageDocuments,
              total: 105,
              page: 2,
              pageSize: 100,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (
        input ===
        `/api/workflows?${createWorkflowSearchParams(firstPageDocuments.map((document) => document.id))}`
      ) {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'workflow_1',
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
              ],
              total: 1,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (
        input ===
        `/api/workflows?${createWorkflowSearchParams(secondPageDocuments.map((document) => document.id))}`
      ) {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'workflow_105',
                  workflowKey: 'ingestion',
                  status: 'ERROR',
                  errorMessage: 'Needs attention.',
                  createdAt: '2026-01-03T00:00:00.000Z',
                  updatedAt: '2026-01-03T00:00:30.000Z',
                  startedAt: '2026-01-03T00:00:00.000Z',
                  completedAt: '2026-01-03T00:10:00.000Z',
                  uploadId: 'upload_105',
                  documentId: 'document_105',
                  reconciliationRequired: false,
                },
              ],
              total: 1,
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

    const { result } = renderHook(() => useDocuments({ pageSize: 100 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.documents).toHaveLength(100);
    expect(result.current.workflowsByDocumentId.get('document_1')).toMatchObject({ status: 'RUNNING' });

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.documents).toHaveLength(105));
    await waitFor(() => expect(result.current.workflowsByDocumentId.get('document_105')).toMatchObject({ status: 'ERROR' }));

    const workflowRequests = fetchSpy.mock.calls
      .map(([input]) => input)
      .filter((input): input is string => typeof input === 'string' && input.startsWith('/api/workflows?'));
    expect(workflowRequests).toEqual([
      `/api/workflows?${createWorkflowSearchParams(firstPageDocuments.map((document) => document.id))}`,
      `/api/workflows?${createWorkflowSearchParams(secondPageDocuments.map((document) => document.id))}`,
    ]);
  });
});
