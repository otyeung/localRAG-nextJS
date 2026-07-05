'use client';

import { useQuery } from '@tanstack/react-query';

import { toChatUiMessages, type ChatUiMessage, type PublicMessageRecord } from '@/lib/chat/public-message-ui';

const MESSAGE_PAGE_SIZE = 100;
const MAX_MESSAGE_PAGES = 1_000;

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
      const allMessages: PublicMessageRecord[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;

      while (page <= MAX_MESSAGE_PAGES && allMessages.length < total) {
        const searchParams = new URLSearchParams({
          conversationId: conversationId as string,
          page: String(page),
          pageSize: String(MESSAGE_PAGE_SIZE),
          order: 'asc',
        });
        const response = await requestJson<PublicMessagesPayload>(`/api/messages?${searchParams.toString()}`);
        const effectivePageSize = response.pageSize > 0 ? response.pageSize : MESSAGE_PAGE_SIZE;

        total = Number.isFinite(response.total) ? Math.max(response.total, allMessages.length + response.items.length) : total;
        allMessages.push(...response.items);

        if (response.items.length === 0 || response.items.length < effectivePageSize) {
          break;
        }

        page += 1;
      }

      return toChatUiMessages(allMessages);
    },
  });
}
