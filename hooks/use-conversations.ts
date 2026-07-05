'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type ConversationSummary = {
  id: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
  activeAgentName: string | null;
};

type ConversationsPayload = {
  items: ConversationSummary[];
  total: number;
  page: number;
  pageSize: number;
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

export function useConversations({
  query,
  status,
  page = 1,
  pageSize = 20,
}: {
  query?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  page?: number;
  pageSize?: number;
} = {}) {
  const queryClient = useQueryClient();
  const searchParams = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (query?.trim()) {
    searchParams.set('query', query.trim());
  }

  if (status) {
    searchParams.set('status', status);
  }

  const conversationsQuery = useQuery({
    queryKey: ['conversations', { query: query ?? '', status: status ?? 'all', page, pageSize }],
    queryFn: () => requestJson<ConversationsPayload>(`/api/conversations?${searchParams.toString()}`),
  });

  const invalidateConversations = async () => {
    await queryClient.invalidateQueries({ queryKey: ['conversations'] });
  };

  const createConversation = useMutation({
    mutationFn: (payload: { title?: string } = {}) =>
      requestJson<ConversationSummary>('/api/conversations', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
    onSuccess: invalidateConversations,
  });

  const renameConversation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      requestJson<ConversationSummary>(`/api/conversations/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title }),
      }),
    onSuccess: invalidateConversations,
  });

  const deleteConversation = useMutation({
    mutationFn: (id: string) =>
      requestJson<ConversationSummary>(`/api/conversations/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidateConversations,
  });

  return {
    ...conversationsQuery,
    conversations: conversationsQuery.data?.items ?? [],
    createConversation,
    renameConversation,
    deleteConversation,
  };
}
