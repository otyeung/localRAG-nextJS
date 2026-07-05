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
        metadata: { createdAt: '2026-01-01T00:00:30.000Z' },
      },
    ]);
  });
});
