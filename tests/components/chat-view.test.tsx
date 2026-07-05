import '@testing-library/jest-dom/vitest';
import { createElement, useState } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';

const useChatMock = vi.hoisted(() => vi.fn());
const useConversationMessagesMock = vi.hoisted(() => vi.fn());
const useUserSettingsMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@ai-sdk/react', () => ({
  useChat: useChatMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/hooks/use-conversation-messages', () => ({
  useConversationMessages: useConversationMessagesMock,
}));

vi.mock('@/hooks/use-user-settings', () => ({
  useUserSettings: useUserSettingsMock,
}));

import { ChatView } from '@/components/chat/chat-view';

const messages: UIMessage[] = [
  {
    id: 'user_1',
    role: 'user',
    parts: [{ type: 'text', text: 'Summarize the latest upload.' }],
  },
  {
    id: 'assistant_1',
    role: 'assistant',
    metadata: {
      model: 'gpt-4.1-mini',
      agent: 'Knowledge agent',
    },
    parts: [
      { type: 'text', text: '| Col A | Col B |\n| --- | --- |\n| 1 | 2 |' },
      { type: 'reasoning', text: 'Inspected the indexed report.' },
      { type: 'source-document', sourceId: 'doc_1', mediaType: 'application/pdf', title: 'Quarterly Report' },
    ],
  },
];

describe('ChatView', () => {
  const queryClient = {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  };

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useChatMock.mockReset();
    useConversationMessagesMock.mockReset();
    useChatMock.mockReturnValue({
      messages,
      setMessages: vi.fn(),
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      clearError: vi.fn(),
      status: 'ready',
      error: undefined,
    });
    useConversationMessagesMock.mockReturnValue({
      data: [],
      isLoading: false,
      isSuccess: true,
      error: null,
    });
    useQueryClientMock.mockReturnValue(queryClient);
    queryClient.invalidateQueries.mockClear();
    useUserSettingsMock.mockReturnValue({
      data: {
        theme: 'system',
        model: 'gpt-4.1-mini',
        showReasoningMetadata: true,
      },
    });
  });

  it('renders the message composer and core chat actions', () => {
    render(createElement(ChatView, { initialConversationId: null }));

    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry response' }).length).toBeGreaterThan(0);
  });

  it('disables retry latest response when no transcript is available', () => {
    useChatMock.mockReturnValue({
      messages: [],
      setMessages: vi.fn(),
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      clearError: vi.fn(),
      status: 'ready',
      error: undefined,
    });

    render(createElement(ChatView, { initialConversationId: null }));

    expect(screen.getByRole('button', { name: 'Retry response' })).toBeDisabled();
  });

  it('renders assistant metadata, markdown tables, and citations', () => {
    render(createElement(ChatView, { initialConversationId: 'conversation_1' }));

    expect(screen.getAllByText('Knowledge agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gpt-4.1-mini').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Quarterly Report').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Copy message' }).length).toBeGreaterThan(0);
  });

  it('hydrates saved transcripts into useChat messages for an existing conversation', async () => {
    useChatMock.mockImplementation(() => {
      const [hydratedMessages, setHydratedMessages] = useState<UIMessage[]>([]);

      return {
        messages: hydratedMessages,
        setMessages: setHydratedMessages,
        sendMessage: vi.fn(),
        regenerate: vi.fn(),
        stop: vi.fn(),
        clearError: vi.fn(),
        status: 'ready',
        error: undefined,
      };
    });
    useConversationMessagesMock.mockReturnValue({
      data: [
        {
          id: 'persisted_user',
          role: 'user',
          parts: [{ type: 'text', text: 'Load the saved transcript.' }],
          metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
        },
        {
          id: 'persisted_assistant',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Transcript restored.' },
            {
              type: 'dynamic-tool',
              toolName: 'retrieve_chunks',
              toolCallId: 'tool_1',
              state: 'output-available',
            },
            { type: 'source-document', sourceId: 'document_1', title: 'Quarterly Report' },
          ],
          metadata: { createdAt: '2026-01-01T00:00:30.000Z' },
        },
      ],
      isLoading: false,
      isSuccess: true,
      error: null,
    });

    render(createElement(ChatView, { initialConversationId: 'conversation_saved' }));

    await waitFor(() => expect(screen.getByText('Transcript restored.')).toBeInTheDocument());
    expect(screen.getByLabelText('Tool retrieve chunks completed')).toBeInTheDocument();
  });

  it('does not overwrite an active streaming transcript when saved messages finish loading', async () => {
    const setMessages = vi.fn();

    useChatMock.mockReturnValue({
      messages: [{ id: 'live_user', role: 'user', parts: [{ type: 'text', text: 'Keep streaming.' }] }],
      setMessages,
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      clearError: vi.fn(),
      status: 'streaming',
      error: undefined,
    });
    useConversationMessagesMock.mockReturnValue({
      data: [
        {
          id: 'persisted_user',
          role: 'user',
          parts: [{ type: 'text', text: 'Older transcript.' }],
        },
      ],
      isLoading: false,
      isSuccess: true,
      error: null,
    });

    render(createElement(ChatView, { initialConversationId: 'conversation_streaming' }));

    await waitFor(() => {
      expect(screen.getByText('Streaming answer')).toBeInTheDocument();
    });
    expect(setMessages).not.toHaveBeenCalled();
  });

  it('invalidates conversations and selects the server conversation when streaming finishes', async () => {
    const onConversationResolved = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          'x-conversation-id': 'conversation_server_1',
        },
      }),
    );

    render(createElement(ChatView, { initialConversationId: null, onConversationResolved }));

    const chatOptions = useChatMock.mock.calls[0]?.[0];
    const transport = chatOptions?.transport as {
      fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    };

    await transport.fetch?.('/api/chat', {
      method: 'POST',
    });
    await chatOptions?.onFinish?.({
      message: messages[1],
      messages,
      isAbort: false,
      isDisconnect: false,
      isError: false,
      finishReason: 'stop',
    });

    await waitFor(() => {
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversations'] });
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['messages', 'conversation_server_1'] });
    });
    expect(onConversationResolved).toHaveBeenCalledWith('conversation_server_1');
    expect(fetchSpy).toHaveBeenCalledWith('/api/chat', {
      method: 'POST',
    });
  });

  it('renders accessible tool execution states and ignores unknown parts', () => {
    useChatMock.mockReturnValue({
      messages: [
        {
          id: 'assistant_tools',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Working on it.' },
            {
              type: 'tool-retrieve_chunks',
              toolCallId: 'tool_1',
              state: 'input-available',
              input: { query: 'report' },
            },
            {
              type: 'tool-retrieve_chunks',
              toolCallId: 'tool_2',
              state: 'output-available',
              input: { query: 'report' },
              output: { chunks: [] },
            },
            {
              type: 'dynamic-tool',
              toolName: 'search_documents',
              toolCallId: 'tool_3',
              state: 'output-error',
              input: { query: 'missing' },
              errorText: 'Lookup failed.',
            },
            {
              type: 'custom-part',
              payload: 'ignored',
            } as never,
          ],
        },
      ],
      setMessages: vi.fn(),
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      clearError: vi.fn(),
      status: 'ready',
      error: undefined,
    });

    render(createElement(ChatView, { initialConversationId: 'conversation_tools' }));

    expect(screen.getByLabelText('Tool retrieve chunks running')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool retrieve chunks completed')).toBeInTheDocument();
    expect(screen.getByLabelText('Tool search documents failed')).toBeInTheDocument();
    expect(screen.queryByText('ignored')).not.toBeInTheDocument();
  });

  it('hides reasoning metadata when user settings disable it', () => {
    useUserSettingsMock.mockReturnValue({
      data: {
        theme: 'system',
        model: 'gpt-4.1-mini',
        showReasoningMetadata: false,
      },
    });

    render(createElement(ChatView, { initialConversationId: 'conversation_1' }));

    expect(screen.queryByText('Reasoning metadata')).not.toBeInTheDocument();
    expect(screen.queryByText('Inspected the indexed report.')).not.toBeInTheDocument();
  });
});
