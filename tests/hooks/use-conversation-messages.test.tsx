import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationMessages } from '@/hooks/use-conversation-messages';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'ConversationMessagesQueryClientWrapper';

  return Wrapper;
}

describe('useConversationMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads persisted messages from the same-origin messages API and converts them to UI messages', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            items: [
              {
                id: 'message_1',
                role: 'USER',
                content: 'Restore this transcript.',
                citations: null,
                toolCalls: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
              {
                id: 'message_2',
                role: 'ASSISTANT',
                content: 'Transcript restored.',
                citations: [
                  {
                    documentId: 'document_1',
                    documentName: 'Quarterly Report',
                  },
                ],
                toolCalls: null,
                metadata: {
                  activeAgentName: 'Knowledge agent',
                  model: 'gpt-4.1-mini',
                  requestId: 'req_hidden',
                },
                createdAt: '2026-01-01T00:00:30.000Z',
                updatedAt: '2026-01-01T00:00:30.000Z',
              },
            ],
            total: 2,
            page: 1,
            pageSize: 50,
            order: 'asc',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const { result } = renderHook(() => useConversationMessages('conversation_1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenCalledWith('/api/messages?conversationId=conversation_1&page=1&pageSize=100&order=asc', undefined);
    expect(result.current.data).toEqual([
      {
        id: 'message_1',
        role: 'user',
        parts: [{ type: 'text', text: 'Restore this transcript.' }],
        metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
      },
      {
        id: 'message_2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Transcript restored.' },
          { type: 'source-document', sourceId: 'document_1', mediaType: 'text/plain', title: 'Quarterly Report' },
        ],
        metadata: {
          createdAt: '2026-01-01T00:00:30.000Z',
          activeAgentName: 'Knowledge agent',
          model: 'gpt-4.1-mini',
        },
      },
    ]);
  });

  it('pages through the same-origin messages API until all saved messages are hydrated in ascending order', async () => {
    const firstPageItems = Array.from({ length: 100 }, (_, index) => ({
      id: `message_${index + 1}`,
      role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
      content: `Message ${index + 1}`,
      citations: null,
      toolCalls: null,
      createdAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
      updatedAt: `2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const secondPageItems = [
      {
        id: 'message_101',
        role: 'USER',
        content: 'Message 101',
        citations: null,
        toolCalls: null,
        createdAt: '2026-01-01T00:01:40.000Z',
        updatedAt: '2026-01-01T00:01:40.000Z',
      },
      {
        id: 'message_102',
        role: 'ASSISTANT',
        content: 'Message 102',
        citations: null,
        toolCalls: null,
        createdAt: '2026-01-01T00:01:41.000Z',
        updatedAt: '2026-01-01T00:01:41.000Z',
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/api/messages?conversationId=conversation_paginated&page=1&pageSize=100&order=asc') {
        return new Response(
          JSON.stringify({
            data: {
              items: firstPageItems,
              total: 102,
              page: 1,
              pageSize: 100,
              order: 'asc',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/messages?conversationId=conversation_paginated&page=2&pageSize=100&order=asc') {
        return new Response(
          JSON.stringify({
            data: {
              items: secondPageItems,
              total: 102,
              page: 2,
              pageSize: 100,
              order: 'asc',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected fetch: ${String(input)}`);
    });

    const { result } = renderHook(() => useConversationMessages('conversation_paginated'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/messages?conversationId=conversation_paginated&page=1&pageSize=100&order=asc', undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/messages?conversationId=conversation_paginated&page=2&pageSize=100&order=asc', undefined);
    expect(result.current.data).toHaveLength(102);
    expect(result.current.data?.[0]).toMatchObject({
      id: 'message_1',
      role: 'user',
    });
    expect(result.current.data?.[101]).toMatchObject({
      id: 'message_102',
      role: 'assistant',
    });
  });
});
