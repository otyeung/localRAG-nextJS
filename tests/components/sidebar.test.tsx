import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sidebar } from '@/components/sidebar/sidebar';

describe('Sidebar', () => {
  afterEach(() => {
    cleanup();
  });

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
        healthTone: 'warning',
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

  it('opens the user menu with accessible actions', () => {
    render(
      createElement(Sidebar, {
        activeConversationId: null,
        conversations: [],
        conversationSearchValue: '',
        onConversationSearchChange: vi.fn(),
        onConversationSelect: vi.fn(),
        onNewChat: vi.fn(),
        onConversationRename: vi.fn(),
        onConversationDelete: vi.fn(),
        onKnowledgeBase: vi.fn(),
        onSettings: vi.fn(),
        healthLabel: 'Healthy',
        healthTone: 'success',
      }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'User Menu' })[0]);

    const menu = screen.getByRole('menu');

    expect(menu).toBeInTheDocument();
    expect(within(menu).getByText('Anonymous analyst session')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Open settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'View system status' })).toBeInTheDocument();
  });

  it('renders accessible loading and error states for conversations', () => {
    const { rerender } = render(
      createElement(Sidebar, {
        activeConversationId: null,
        conversations: [],
        conversationSearchValue: '',
        onConversationSearchChange: vi.fn(),
        onConversationSelect: vi.fn(),
        onNewChat: vi.fn(),
        onConversationRename: vi.fn(),
        onConversationDelete: vi.fn(),
        healthLabel: 'Checking',
        healthTone: 'neutral',
        isLoadingConversations: true,
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading conversations…');
    expect(screen.queryByText('No conversations match the current filters.')).not.toBeInTheDocument();

    rerender(
      createElement(Sidebar, {
        activeConversationId: null,
        conversations: [],
        conversationSearchValue: '',
        onConversationSearchChange: vi.fn(),
        onConversationSelect: vi.fn(),
        onNewChat: vi.fn(),
        onConversationRename: vi.fn(),
        onConversationDelete: vi.fn(),
        healthLabel: 'Needs attention',
        healthTone: 'danger',
        isLoadingConversations: false,
        conversationsError: 'Conversation service unavailable.',
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Conversation service unavailable.');
    expect(screen.queryByText('No conversations match the current filters.')).not.toBeInTheDocument();
  });

  it('uses the provided health tone for the system badge', () => {
    render(
      createElement(Sidebar, {
        activeConversationId: null,
        conversations: [],
        conversationSearchValue: '',
        onConversationSearchChange: vi.fn(),
        onConversationSelect: vi.fn(),
        onNewChat: vi.fn(),
        onConversationRename: vi.fn(),
        onConversationDelete: vi.fn(),
        healthLabel: 'Health unavailable',
        healthTone: 'danger',
      }),
    );

    expect(screen.getByText('Health unavailable').closest('span')).toHaveClass('text-rose-200');
  });
});
