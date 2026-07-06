'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { DatabaseZap, MessageSquarePlus, Settings2, ShieldCheck, UserRound } from 'lucide-react';

import { StatusBadge } from '@/components/common/status-badge';
import { ConversationList } from '@/components/sidebar/conversation-list';
import type { ConversationSummary } from '@/hooks/use-conversations';

type HealthTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export function Sidebar({
  conversations,
  totalConversations = conversations.length,
  hasMoreConversations = false,
  onLoadMoreConversations,
  isLoadingMoreConversations = false,
  isLoadingConversations = false,
  conversationsError = null,
  activeConversationId,
  conversationSearchValue,
  onConversationSearchChange,
  onConversationSelect,
  onNewChat,
  onConversationRename,
  onConversationDelete,
  onKnowledgeBase,
  onSettings,
  healthLabel,
  healthTone,
}: {
  conversations: ConversationSummary[];
  totalConversations?: number;
  hasMoreConversations?: boolean;
  onLoadMoreConversations?: () => void;
  isLoadingMoreConversations?: boolean;
  isLoadingConversations?: boolean;
  conversationsError?: string | null;
  activeConversationId: string | null;
  conversationSearchValue: string;
  onConversationSearchChange: (value: string) => void;
  onConversationSelect: (id: string) => void;
  onNewChat: () => void;
  onConversationRename: (conversation: ConversationSummary) => void;
  onConversationDelete: (conversation: ConversationSummary) => void;
  onKnowledgeBase?: () => void;
  onSettings?: () => void;
  healthLabel: string;
  healthTone: HealthTone;
}) {
  const [searchValue, setSearchValue] = useState(conversationSearchValue);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSearchValue(conversationSearchValue);
  }, [conversationSearchValue]);

  useEffect(() => {
    if (!isUserMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isUserMenuOpen]);

  const visibleConversations = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      const haystack = [
        conversation.title,
        conversation.lastMessagePreview ?? '',
        conversation.activeAgentName ?? '',
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [conversations, searchValue]);

  return (
    <aside className="glass-panel flex h-full min-w-0 flex-col gap-5 p-5">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[color:var(--text-dim)]">
              Mission Control
            </p>
            <h2 className="mt-2 font-display text-2xl text-[color:var(--text-strong)]">LocalRAG</h2>
          </div>
          <StatusBadge label={healthLabel} tone={healthTone} pulse={healthTone === 'success'} />
        </div>

        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--accent)] px-4 py-3 text-sm font-semibold text-[color:var(--accent-foreground)] shadow-[0_20px_45px_rgba(59,130,246,0.28)] transition hover:translate-y-[-1px]"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New Chat
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-3 py-3 text-left text-sm font-medium text-[color:var(--text-strong)] transition hover:border-[color:var(--accent)]"
            onClick={onKnowledgeBase}
          >
            <DatabaseZap className="mb-2 h-4 w-4 text-[color:var(--text-muted)]" />
            Knowledge Base
          </button>
          <button
            type="button"
            className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-3 py-3 text-left text-sm font-medium text-[color:var(--text-strong)] transition hover:border-[color:var(--accent)]"
            onClick={onSettings}
          >
            <Settings2 className="mb-2 h-4 w-4 text-[color:var(--text-muted)]" />
            Settings
          </button>
        </div>
      </div>

      <label className="space-y-2 text-sm">
        <span className="text-[0.72rem] uppercase tracking-[0.2em] text-[color:var(--text-dim)]">
          Search conversations
        </span>
        <input
          aria-label="Search conversations"
          value={searchValue}
          onChange={(event) => {
            setSearchValue(event.target.value);
            onConversationSearchChange(event.target.value);
          }}
          placeholder="Search title, preview, or agent"
          className="w-full rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3 text-sm text-[color:var(--text-strong)] outline-none transition placeholder:text-[color:var(--text-dim)] focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent-soft)]"
        />
      </label>

      <section className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[color:var(--text-strong)]">Recent conversations</h3>
          <span className="text-xs text-[color:var(--text-dim)]">
            {visibleConversations.length} of {totalConversations}
          </span>
        </div>
        <ConversationList
          conversations={visibleConversations}
          activeConversationId={activeConversationId}
          isLoading={isLoadingConversations}
          error={conversationsError}
          onConversationSelect={onConversationSelect}
          onConversationRename={onConversationRename}
          onConversationDelete={onConversationDelete}
        />
        {hasMoreConversations ? (
          <button
            type="button"
            className="w-full rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3 text-sm font-medium text-[color:var(--text-strong)] transition hover:border-[color:var(--accent)] disabled:cursor-wait disabled:opacity-70"
            onClick={onLoadMoreConversations}
            disabled={isLoadingMoreConversations}
          >
            {isLoadingMoreConversations ? 'Loading more…' : 'Load more conversations'}
          </button>
        ) : null}
      </section>

      <div className="space-y-3 border-t border-[color:var(--border-soft)] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[color:var(--text-strong)]">System Status</span>
          <ShieldCheck className="h-4 w-4 text-[color:var(--text-muted)]" />
        </div>
        <p className="text-sm text-[color:var(--text-muted)]">
          Queue, indexing, and orchestration telemetry stays visible here while you work.
        </p>
        <div ref={userMenuRef} className="relative">
          <button
            type="button"
            aria-label="User Menu"
            aria-haspopup="menu"
            aria-expanded={isUserMenuOpen}
            className="flex w-full items-center gap-3 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3 text-left"
            onClick={() => setIsUserMenuOpen((current) => !current)}
          >
            <span className="rounded-full border border-[color:var(--border-soft)] p-2 text-[color:var(--text-muted)]">
              <UserRound className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-medium text-[color:var(--text-strong)]">User Menu</span>
              <span className="block text-xs text-[color:var(--text-dim)]">Anonymous analyst session</span>
            </span>
          </button>
          {isUserMenuOpen ? (
            <div
              role="menu"
              aria-label="User Menu"
              className="absolute bottom-[calc(100%+0.75rem)] left-0 z-10 w-full rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-2 shadow-[var(--shadow-panel)]"
            >
              <div className="rounded-xl px-3 py-2">
                <p className="text-sm font-medium text-[color:var(--text-strong)]">Anonymous analyst session</p>
                <p className="mt-1 text-xs text-[color:var(--text-dim)]">Auth provider integration is planned for a later task.</p>
              </div>
              <div className="my-2 h-px bg-[color:var(--border-soft)]" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full rounded-xl px-3 py-2 text-left text-sm text-[color:var(--text-strong)] transition hover:bg-[color:var(--panel-subtle)]"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  onSettings?.();
                }}
              >
                Open settings
              </button>
              <button
                type="button"
                role="menuitem"
                className="mt-1 flex w-full rounded-xl px-3 py-2 text-left text-sm text-[color:var(--text-strong)] transition hover:bg-[color:var(--panel-subtle)]"
                onClick={() => {
                  setIsUserMenuOpen(false);
                }}
              >
                View system status
              </button>
              <button
                type="button"
                role="menuitem"
                disabled
                className="mt-1 flex w-full cursor-not-allowed rounded-xl px-3 py-2 text-left text-sm text-[color:var(--text-dim)] opacity-70"
              >
                Sign in coming soon
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
