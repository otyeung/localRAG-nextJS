import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Sidebar } from '@/components/sidebar/sidebar';

describe('Sidebar', () => {
  it('renders stable navigation labels, filters conversations, and requests more results', () => {
    const onConversationSelect = vi.fn();
    const onLoadMore = vi.fn();

    render(
      createElement(Sidebar, {
        activeConversationId: 'conversation_1',
        conversations: [
          {
            id: 'conversation_1',
            title: 'Quarterly Report Review',
            status: 'ACTIVE',
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            messageCount: 8,
            lastMessagePreview: 'Summarize the report',
            activeAgentName: 'Knowledge agent',
          },
          {
            id: 'conversation_2',
            title: 'Vendor Security Questionnaire',
            status: 'ARCHIVED',
            updatedAt: '2026-01-02T00:00:00.000Z',
            createdAt: '2026-01-02T00:00:00.000Z',
            messageCount: 3,
            lastMessagePreview: 'Review the controls',
            activeAgentName: null,
          },
        ],
        conversationSearchValue: '',
        onConversationSearchChange: vi.fn(),
        onConversationSelect,
        onNewChat: vi.fn(),
        onConversationRename: vi.fn(),
        onConversationDelete: vi.fn(),
        healthLabel: 'Pending Task 9',
        totalConversations: 45,
        hasMoreConversations: true,
        onLoadMoreConversations: onLoadMore,
        isLoadingMoreConversations: false,
      }),
    );

    expect(screen.getByRole('button', { name: 'New Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Knowledge Base' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('System Status')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search conversations'), {
      target: { value: 'Vendor' },
    });

    expect(screen.getByText('Vendor Security Questionnaire')).toBeInTheDocument();
    expect(screen.queryByText('Quarterly Report Review')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Load more conversations' }));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1 of 45')).toBeInTheDocument();
  });
});
