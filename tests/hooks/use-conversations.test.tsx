import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversations } from '@/hooks/use-conversations';

function createWrapper(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'ConversationsQueryClientWrapper';

  return Wrapper;
}

describe('useConversations', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads additional conversation pages from the same-origin API', async () => {
    const firstPageItems = Array.from({ length: 30 }, (_, index) => ({
      id: `conversation_${index + 1}`,
      title: `Conversation ${index + 1}`,
      status: 'ACTIVE' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messageCount: index + 1,
      lastMessagePreview: `Preview ${index + 1}`,
      activeAgentName: null,
    }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/api/conversations?page=1&pageSize=30') {
        return new Response(
          JSON.stringify({
            data: {
              items: firstPageItems,
              total: 31,
              page: 1,
              pageSize: 30,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/conversations?page=2&pageSize=30') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'conversation_31',
                  title: 'Conversation 31',
                  status: 'ARCHIVED',
                  createdAt: '2026-01-02T00:00:00.000Z',
                  updatedAt: '2026-01-02T00:00:00.000Z',
                  messageCount: 31,
                  lastMessagePreview: 'Preview 31',
                  activeAgentName: 'Knowledge agent',
                },
              ],
              total: 31,
              page: 2,
              pageSize: 30,
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

    const { result } = renderHook(() => useConversations({ pageSize: 30 }), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.conversations).toHaveLength(30);
    expect(result.current.hasNextPage).toBe(true);

    await result.current.fetchNextPage();

    await waitFor(() => expect(result.current.conversations).toHaveLength(31));

    expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/conversations?page=1&pageSize=30', undefined);
    expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/conversations?page=2&pageSize=30', undefined);
    expect(result.current.conversations[30]).toMatchObject({
      id: 'conversation_31',
      status: 'ARCHIVED',
    });
    expect(result.current.hasNextPage).toBe(false);
  });

  it('resets to the first page when the search query changes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (input === '/api/conversations?page=1&pageSize=30') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'conversation_1',
                  title: 'Conversation 1',
                  status: 'ACTIVE',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                  messageCount: 1,
                  lastMessagePreview: 'Preview 1',
                  activeAgentName: null,
                },
              ],
              total: 2,
              page: 1,
              pageSize: 30,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/conversations?page=2&pageSize=30') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'conversation_2',
                  title: 'Conversation 2',
                  status: 'ACTIVE',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  updatedAt: '2026-01-01T00:00:00.000Z',
                  messageCount: 2,
                  lastMessagePreview: 'Preview 2',
                  activeAgentName: null,
                },
              ],
              total: 2,
              page: 2,
              pageSize: 30,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      if (input === '/api/conversations?page=1&pageSize=30&query=archived') {
        return new Response(
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'conversation_archived',
                  title: 'Archived Conversation',
                  status: 'ARCHIVED',
                  createdAt: '2026-01-03T00:00:00.000Z',
                  updatedAt: '2026-01-03T00:00:00.000Z',
                  messageCount: 7,
                  lastMessagePreview: 'Archived preview',
                  activeAgentName: null,
                },
              ],
              total: 1,
              page: 1,
              pageSize: 30,
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

    const { result, rerender } = renderHook(({ query }) => useConversations({ query, pageSize: 30 }), {
      initialProps: { query: '' },
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await result.current.fetchNextPage();
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    rerender({ query: 'archived' });

    await waitFor(() =>
      expect(result.current.conversations).toEqual([
        expect.objectContaining({
          id: 'conversation_archived',
          title: 'Archived Conversation',
        }),
      ]),
    );

    expect(fetchSpy).toHaveBeenNthCalledWith(3, '/api/conversations?page=1&pageSize=30&query=archived', undefined);
    expect(result.current.hasNextPage).toBe(false);
  });
});
