'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type DocumentRecord = {
  id: string;
  uploadId: string;
  status: 'PENDING' | 'INGESTING' | 'READY' | 'FAILED' | 'DELETED';
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type WorkflowRecord = {
  id: string;
  workflowKey: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCESS' | 'ERROR' | 'CANCELED' | 'WAITING';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  uploadId: string | null;
  documentId: string | null;
  reconciliationRequired: boolean;
};

export type ReindexDocumentResult = {
  workflowExecutionId: string;
  status: WorkflowRecord['status'];
  reconciliationRequired: boolean;
};

type DocumentPayload = {
  items: DocumentRecord[];
  total: number;
  page: number;
  pageSize: number;
};

type WorkflowPayload = {
  items: WorkflowRecord[];
  total: number;
};

type ApiResponse<T> = { data: T };

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json().catch(() => null)) as
    | ApiResponse<T>
    | { error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(body && 'error' in body ? body.error?.message ?? 'Request failed.' : 'Request failed.');
  }

  return (body as ApiResponse<T>).data;
}

export function useDocuments({
  search,
  status,
  sort = 'updatedAt',
  order = 'desc',
  pageSize = 20,
}: {
  search?: string;
  status?: 'PENDING' | 'INGESTING' | 'READY' | 'FAILED';
  sort?: 'createdAt' | 'updatedAt' | 'title';
  order?: 'asc' | 'desc';
  pageSize?: number;
} = {}) {
  const queryClient = useQueryClient();
  const normalizedSearch = search?.trim() ?? '';

  const documentsQuery = useInfiniteQuery({
    queryKey: ['documents', { search: normalizedSearch, status: status ?? 'all', sort, order, pageSize }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const searchParams = new URLSearchParams({
        page: String(pageParam),
        pageSize: String(pageSize),
        sort,
        order,
      });

      if (normalizedSearch) {
        searchParams.set('query', normalizedSearch);
      }

      if (status) {
        searchParams.set('status', status);
      }

      return requestJson<DocumentPayload>(`/api/documents?${searchParams.toString()}`);
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((count, currentPage) => count + currentPage.items.length, 0);
      return loadedCount < lastPage.total ? allPages.length + 1 : undefined;
    },
  });

  const workflowsQuery = useQuery({
    queryKey: ['workflows'],
    queryFn: () => requestJson<WorkflowPayload>('/api/workflows'),
  });

  const deleteDocument = useMutation({
    mutationFn: (id: string) =>
      requestJson<DocumentRecord>(`/api/documents/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
      ]);
    },
  });

  const reindexDocument = useMutation({
    mutationFn: (id: string) =>
      requestJson<ReindexDocumentResult>(`/api/documents/${id}`, {
        method: 'PATCH',
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
      ]);
    },
  });

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data?.pages],
  );
  const totalDocuments = documentsQuery.data?.pages[0]?.total ?? 0;
  const workflowsByDocumentId = useMemo(() => {
    const workflowMap = new Map<string, WorkflowRecord>();

    for (const workflow of workflowsQuery.data?.items ?? []) {
      if (!workflow.documentId || workflowMap.has(workflow.documentId)) {
        continue;
      }

      workflowMap.set(workflow.documentId, workflow);
    }

    return workflowMap;
  }, [workflowsQuery.data?.items]);

  return {
    ...documentsQuery,
    workflows: workflowsQuery.data?.items ?? [],
    documents,
    totalDocuments,
    loadedDocuments: documents.length,
    workflowsByDocumentId,
    deleteDocument,
    reindexDocument,
  };
}
