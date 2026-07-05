import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from 'ai';

const useChatMock = vi.hoisted(() => vi.fn());

vi.mock('@ai-sdk/react', () => ({
  useChat: useChatMock,
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
  beforeEach(() => {
    useChatMock.mockReset();
    useChatMock.mockReturnValue({
      messages,
      sendMessage: vi.fn(),
      regenerate: vi.fn(),
      stop: vi.fn(),
      clearError: vi.fn(),
      status: 'ready',
      error: undefined,
    });
  });

  it('renders the message composer and core chat actions', () => {
    render(createElement(ChatView, { initialConversationId: null }));

    expect(screen.getByLabelText('Message input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop generation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry response' })).toBeInTheDocument();
  });

  it('renders assistant metadata, markdown tables, and citations', () => {
    render(createElement(ChatView, { initialConversationId: 'conversation_1' }));

    expect(screen.getAllByText('Knowledge agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('gpt-4.1-mini').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Quarterly Report').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Copy message' }).length).toBeGreaterThan(0);
  });
});
