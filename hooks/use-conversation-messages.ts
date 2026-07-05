'use client';

import { useQuery } from '@tanstack/react-query';

import { toChatUiMessages, type ChatUiMessage, type PublicMessageRecord } from '@/lib/chat/public-message-ui';

type PublicMessagesPayload = {
  items: PublicMessageRecord[];
  total: number;
  page: number;
  pageSize: number;
  order: 'asc' | 'desc';
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

export function useConversationMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['messages', conversationId],
    enabled: Boolean(conversationId),
    queryFn: async (): Promise<ChatUiMessage[]> => {
      const searchParams = new URLSearchParams({
        conversationId: conversationId as string,
        page: '1',
        pageSize: '100',
        order: 'asc',
      });
      const response = await requestJson<PublicMessagesPayload>(`/api/messages?${searchParams.toString()}`);

      return toChatUiMessages(response.items);
    },
  });
}
