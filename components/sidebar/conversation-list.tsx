'use client';

import { MessageSquareMore, Pencil, Trash2 } from 'lucide-react';

import { StatusBadge } from '@/components/common/status-badge';
import type { ConversationSummary } from '@/hooks/use-conversations';

export function ConversationList({
  conversations,
  activeConversationId,
  onConversationSelect,
  onConversationRename,
  onConversationDelete,
}: {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onConversationSelect: (id: string) => void;
  onConversationRename: (conversation: ConversationSummary) => void;
  onConversationDelete: (conversation: ConversationSummary) => void;
}) {
  if (conversations.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
        No conversations match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map((conversation) => {
        const isActive = conversation.id === activeConversationId;

        return (
          <article
            key={conversation.id}
            className={[
              'rounded-2xl border p-3 transition',
              isActive
                ? 'border-[color:var(--accent)] bg-[color:var(--panel-elevated)] shadow-[var(--shadow-panel)]'
                : 'border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] hover:border-[color:var(--border-strong)]',
            ].join(' ')}
          >
            <button
              type="button"
              className="flex w-full items-start gap-3 text-left"
              onClick={() => onConversationSelect(conversation.id)}
            >
              <span className="mt-0.5 rounded-xl border border-[color:var(--border-soft)] bg-black/10 p-2 text-[color:var(--text-muted)] dark:bg-white/5">
                <MessageSquareMore className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[color:var(--text-strong)]">
                  {conversation.title}
                </span>
                <span className="mt-1 block truncate text-xs text-[color:var(--text-muted)]">
                  {conversation.lastMessagePreview ?? 'Conversation ready for the next prompt.'}
                </span>
              </span>
            </button>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <StatusBadge
                  label={conversation.status === 'ACTIVE' ? 'Active' : 'Archived'}
                  tone={conversation.status === 'ACTIVE' ? 'info' : 'neutral'}
                />
                {conversation.activeAgentName ? (
                  <span className="text-[0.7rem] uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
                    {conversation.activeAgentName}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-full border border-transparent p-2 text-[color:var(--text-muted)] transition hover:border-[color:var(--border-soft)] hover:text-[color:var(--text-strong)]"
                  aria-label={`Rename conversation ${conversation.title}`}
                  onClick={() => onConversationRename(conversation)}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-full border border-transparent p-2 text-[color:var(--text-muted)] transition hover:border-rose-500/30 hover:text-rose-400"
                  aria-label={`Delete conversation ${conversation.title}`}
                  onClick={() => onConversationDelete(conversation)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
