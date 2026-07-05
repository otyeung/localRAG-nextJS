'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { AlertTriangle, Bot, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { MessageComposer } from '@/components/chat/message-composer';
import { MessageList } from '@/components/chat/message-list';
import { StatusBadge } from '@/components/common/status-badge';

type ChatMessage = UIMessage<{
  model?: string;
  agent?: string;
  activeAgentName?: string;
  createdAt?: string;
}>;

const STATUS_COPY = {
  submitted: 'Dispatching prompt',
  streaming: 'Streaming answer',
  ready: 'Ready',
  error: 'Needs attention',
} as const;

function getLatestAssistant(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant');
}

export function ChatView({ initialConversationId }: { initialConversationId: string | null }) {
  const [draft, setDraft] = useState('');
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: '/api/chat',
        body: {
          conversationId: initialConversationId,
        },
      }),
    [initialConversationId],
  );
  const {
    messages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    clearError,
  } = useChat<ChatMessage>({
    id: initialConversationId ?? 'new-chat',
    transport,
  });

  const latestAssistant = useMemo(() => getLatestAssistant(messages), [messages]);
  const isStreaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !autoScrollEnabled) {
      return;
    }

    if (typeof viewport.scrollTo === 'function') {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: 'smooth',
      });
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, status, autoScrollEnabled]);

  const submit = async () => {
    const nextDraft = draft.trim();
    if (!nextDraft || isStreaming) {
      return;
    }

    await sendMessage(
      { text: nextDraft },
      {
        body: {
          conversationId: initialConversationId,
        },
      },
    );
    setDraft('');
  };

  const copyMessage = async (message: ChatMessage) => {
    const content = message.parts
      .filter((part): part is Extract<ChatMessage['parts'][number], { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n');

    if (!content) {
      return;
    }

    await navigator.clipboard?.writeText(content);
  };

  return (
    <section className="glass-panel flex h-full min-h-[70vh] flex-col overflow-hidden">
      <header className="border-b border-[color:var(--border-soft)] px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--text-dim)]">
              Private document intelligence
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl text-[color:var(--text-strong)]">Evidence-grounded chat</h1>
              <StatusBadge
                label={STATUS_COPY[status as keyof typeof STATUS_COPY] ?? 'Ready'}
                tone={status === 'error' ? 'danger' : isStreaming ? 'info' : 'success'}
                pulse={isStreaming}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-sm text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-strong)]"
              onClick={() => regenerate()}
            >
              <Sparkles className="h-4 w-4" />
              Retry latest response
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-6 mt-5 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4" />
              <p>{error.message}</p>
            </div>
            <button type="button" className="text-xs font-medium uppercase tracking-[0.18em]" onClick={() => clearError()}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={viewportRef}
        className="flex-1 overflow-y-auto px-6 py-5"
        onScroll={(event) => {
          const target = event.currentTarget;
          const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
          setAutoScrollEnabled(distanceFromBottom < 80);
        }}
      >
        {messages.length > 0 ? (
          <MessageList
            messages={messages}
            onCopy={copyMessage}
            onRetry={(message) => regenerate({ messageId: message.id })}
          />
        ) : (
          <div className="flex h-full min-h-[22rem] flex-col items-center justify-center rounded-[2rem] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-10 text-center">
            <span className="rounded-full border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-4 text-[color:var(--text-muted)]">
              <Bot className="h-6 w-6" />
            </span>
            <h2 className="mt-5 font-display text-2xl text-[color:var(--text-strong)]">Start a grounded analysis thread</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[color:var(--text-muted)]">
              Ask for summaries, comparison tables, or source-backed answers. Uploads and workflow state stay visible in the command center while the assistant works.
            </p>
          </div>
        )}
      </div>

      <div className="border-t border-[color:var(--border-soft)] px-6 py-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {latestAssistant?.metadata?.activeAgentName ?? latestAssistant?.metadata?.agent ? (
            <StatusBadge label={latestAssistant?.metadata?.activeAgentName ?? latestAssistant?.metadata?.agent ?? 'Assistant'} tone="success" />
          ) : null}
          {latestAssistant?.metadata?.model ? (
            <StatusBadge label={latestAssistant.metadata.model} tone="neutral" />
          ) : null}
        </div>
        <MessageComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          disabled={!draft.trim()}
          isStreaming={isStreaming}
        />
      </div>
    </section>
  );
}
