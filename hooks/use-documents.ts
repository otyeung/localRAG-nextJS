'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
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
  const pendingReindexDocumentIdsRef = useRef(new Set<string>());
  const [pendingReindexDocumentIds, setPendingReindexDocumentIds] = useState<Set<string>>(new Set());

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

  const documents = useMemo(
    () => documentsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [documentsQuery.data?.pages],
  );
  const totalDocuments = documentsQuery.data?.pages[0]?.total ?? 0;
  const workflowDocumentIds = useMemo(() => Array.from(new Set(documents.map((document) => document.id))), [documents]);

  const workflowsQuery = useQuery({
    queryKey: ['workflows', { documentIds: workflowDocumentIds, pageSize: workflowDocumentIds.length }],
    enabled: workflowDocumentIds.length > 0,
    queryFn: () => {
      const searchParams = new URLSearchParams();

      for (const documentId of workflowDocumentIds) {
        searchParams.append('documentIds', documentId);
      }

      searchParams.set('pageSize', String(workflowDocumentIds.length));

      return requestJson<WorkflowPayload>(`/api/workflows?${searchParams.toString()}`);
    },
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
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['workflows'] }),
      ]);
    },
  });
  const queueReindexDocument = useCallback(
    async (id: string) => {
      if (pendingReindexDocumentIdsRef.current.has(id)) {
        return null;
      }

      pendingReindexDocumentIdsRef.current.add(id);
      setPendingReindexDocumentIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.add(id);
        return nextIds;
      });

      try {
        return await reindexDocument.mutateAsync(id);
      } finally {
        pendingReindexDocumentIdsRef.current.delete(id);
        setPendingReindexDocumentIds((currentIds) => {
          if (!currentIds.has(id)) {
            return currentIds;
          }

          const nextIds = new Set(currentIds);
          nextIds.delete(id);
          return nextIds;
        });
      }
    },
    [reindexDocument],
  );
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
    pendingReindexDocumentIds,
    queueReindexDocument,
    deleteDocument,
    reindexDocument,
  };
}
