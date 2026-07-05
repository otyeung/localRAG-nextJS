'use client';

import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

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
  pageSize = 20,
}: {
  query?: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  pageSize?: number;
} = {}) {
  const queryClient = useQueryClient();
  const normalizedQuery = query?.trim() ?? '';

  const conversationsQuery = useInfiniteQuery({
    queryKey: ['conversations', { query: normalizedQuery, status: status ?? 'all', pageSize }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const searchParams = new URLSearchParams({
        page: String(pageParam),
        pageSize: String(pageSize),
      });

      if (normalizedQuery) {
        searchParams.set('query', normalizedQuery);
      }

      if (status) {
        searchParams.set('status', status);
      }

      return requestJson<ConversationsPayload>(`/api/conversations?${searchParams.toString()}`);
    },
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((count, currentPage) => count + currentPage.items.length, 0);
      return loadedCount < lastPage.total ? allPages.length + 1 : undefined;
    },
  });
  const conversations = useMemo(
    () => conversationsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [conversationsQuery.data?.pages],
  );
  const totalConversations = conversationsQuery.data?.pages[0]?.total ?? 0;

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
    conversations,
    totalConversations,
    loadedConversations: conversations.length,
    createConversation,
    renameConversation,
    deleteConversation,
  };
}
