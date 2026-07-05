'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type DocumentRecord = {
  id: string;
  uploadId: string;
  status: 'PENDING' | 'INGESTING' | 'READY' | 'FAILED' | 'DELETED';
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
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
  externalExecutionId: string | null;
  status: WorkflowRecord['status'];
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
  page = 1,
  pageSize = 20,
}: {
  search?: string;
  status?: 'PENDING' | 'INGESTING' | 'READY' | 'FAILED';
  sort?: 'createdAt' | 'updatedAt' | 'title';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
} = {}) {
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort,
    order,
  });

  if (search?.trim()) {
    searchParams.set('query', search.trim());
  }

  if (status) {
    searchParams.set('status', status);
  }

  const documentsQuery = useQuery({
    queryKey: ['documents', { search: search ?? '', status: status ?? 'all', sort, order, page, pageSize }],
    queryFn: () => requestJson<DocumentPayload>(`/api/documents?${searchParams.toString()}`),
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

  const workflowsByDocumentId = new Map(
    (workflowsQuery.data?.items ?? [])
      .filter((workflow) => workflow.documentId)
      .map((workflow) => [workflow.documentId as string, workflow]),
  );

  return {
    ...documentsQuery,
    workflows: workflowsQuery.data?.items ?? [],
    documents: documentsQuery.data?.items ?? [],
    workflowsByDocumentId,
    deleteDocument,
    reindexDocument,
  };
}
