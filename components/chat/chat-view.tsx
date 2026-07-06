'use client';

import { useChat } from '@ai-sdk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { AlertTriangle, Bot, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MessageComposer } from '@/components/chat/message-composer';
import { MessageList } from '@/components/chat/message-list';
import { StatusBadge } from '@/components/common/status-badge';
import { useConversationMessages } from '@/hooks/use-conversation-messages';
import { useUserSettings } from '@/hooks/use-user-settings';

type ChatMessage = UIMessage<{
  model?: string;
  agent?: string;
  activeAgentName?: string;
  createdAt?: string;
}>;

type PendingChatRequest = {
  startedConversationId: string | null;
  resolvedConversationId: string | null;
  finalized: boolean;
};

const STATUS_COPY = {
  submitted: 'Dispatching prompt',
  streaming: 'Streaming answer',
  ready: 'Ready',
  error: 'Needs attention',
} as const;

function getLatestAssistant(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === 'assistant');
}

export function ChatView({
  initialConversationId,
  onConversationResolved,
}: {
  initialConversationId: string | null;
  onConversationResolved?: (conversationId: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [localConversationId, setLocalConversationId] = useState<string | null>(initialConversationId);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pendingHydrationConversationIdRef = useRef<string | null>(initialConversationId);
  const pendingRequestRef = useRef<PendingChatRequest | null>(null);
  const currentConversationIdRef = useRef<string | null>(initialConversationId);
  const queryClient = useQueryClient();

  const adoptConversationId = useCallback((conversationId: string | null) => {
    currentConversationIdRef.current = conversationId;
    setLocalConversationId(conversationId);
  }, []);

  const shouldAdoptResolvedConversation = useCallback((request: PendingChatRequest, resolvedConversationId: string) => {
    const activeConversationId = currentConversationIdRef.current;

    if (request.startedConversationId === null) {
      return activeConversationId === null || activeConversationId === resolvedConversationId;
    }

    return activeConversationId === request.startedConversationId || activeConversationId === resolvedConversationId;
  }, []);

  const finalizePendingRequest = useCallback(
    async (request: PendingChatRequest | null) => {
      if (!request || request.finalized) {
        return;
      }

      request.finalized = true;
      if (pendingRequestRef.current === request) {
        pendingRequestRef.current = null;
      }

      if (
        request.resolvedConversationId &&
        shouldAdoptResolvedConversation(request, request.resolvedConversationId) &&
        request.resolvedConversationId !== currentConversationIdRef.current
      ) {
        adoptConversationId(request.resolvedConversationId);
        pendingHydrationConversationIdRef.current = request.resolvedConversationId;
        onConversationResolved?.(request.resolvedConversationId);
      }

      await queryClient.invalidateQueries({ queryKey: ['conversations'] });

      const targetConversationId = request.resolvedConversationId ?? request.startedConversationId;
      if (targetConversationId) {
        await queryClient.invalidateQueries({ queryKey: ['messages', targetConversationId] });
      }
    },
    [adoptConversationId, onConversationResolved, queryClient, shouldAdoptResolvedConversation],
  );
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: '/api/chat',
        body: {
          conversationId: localConversationId,
        },
        fetch: async (input, init) => {
          const request: PendingChatRequest = {
            startedConversationId: currentConversationIdRef.current,
            resolvedConversationId: null,
            finalized: false,
          };
          pendingRequestRef.current = request;

          try {
            const response = await fetch(input, init);
            const resolvedConversationId = response.headers.get('x-conversation-id')?.trim();

            request.resolvedConversationId =
              resolvedConversationId && resolvedConversationId.length > 0 ? resolvedConversationId : null;

            if (!response.ok) {
              void finalizePendingRequest(request);
            }

            return response;
          } catch (error) {
            if (pendingRequestRef.current === request) {
              pendingRequestRef.current = null;
            }
            throw error;
          }
        },
      }),
    [finalizePendingRequest, localConversationId],
  );
  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    clearError,
  } = useChat<ChatMessage>({
    id: localConversationId ?? 'new-chat',
    transport,
    onFinish: () => {
      void finalizePendingRequest(pendingRequestRef.current);
    },
  });
  const conversationMessages = useConversationMessages(localConversationId);
  const userSettings = useUserSettings();

  const latestAssistant = useMemo(() => getLatestAssistant(messages), [messages]);
  const isStreaming = status === 'submitted' || status === 'streaming';
  const canRetryLatest = useMemo(
    () => !isStreaming && messages.some((message) => message.role === 'assistant' || message.role === 'user'),
    [isStreaming, messages],
  );
  const showReasoningMetadata = userSettings.data?.showReasoningMetadata ?? true;

  useEffect(() => {
    adoptConversationId(initialConversationId);
    pendingHydrationConversationIdRef.current = initialConversationId;
  }, [adoptConversationId, initialConversationId]);

  useEffect(() => {
    if (!localConversationId || conversationMessages.isSuccess || messages.length === 0) {
      return;
    }

    if (pendingHydrationConversationIdRef.current === localConversationId) {
      pendingHydrationConversationIdRef.current = null;
    }
  }, [conversationMessages.isSuccess, localConversationId, messages.length]);

  useEffect(() => {
    if (!localConversationId || !conversationMessages.isSuccess || isStreaming) {
      return;
    }

    if (pendingHydrationConversationIdRef.current !== localConversationId) {
      return;
    }

    setMessages(conversationMessages.data);
    pendingHydrationConversationIdRef.current = null;
  }, [conversationMessages.data, conversationMessages.isSuccess, isStreaming, localConversationId, setMessages]);

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
          conversationId: currentConversationIdRef.current,
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

  const retryLatest = async () => {
    if (!canRetryLatest) {
      return;
    }

    await regenerate();
  };

  const retryMessage = async (message: ChatMessage) => {
    if (message.role !== 'assistant' || isStreaming) {
      return;
    }

    await regenerate({ messageId: message.id });
  };

  return (
    <section
      data-testid="chat-shell"
      className="glass-panel flex h-[calc(100svh-1rem)] max-h-[calc(100svh-1rem)] flex-col overflow-hidden xl:h-[calc(100vh-9rem)] xl:max-h-[calc(100vh-9rem)]"
    >
      <header className="shrink-0 border-b border-[color:var(--border-soft)] px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[0.72rem] uppercase tracking-[0.22em] text-[color:var(--text-dim)]">
              Private document intelligence
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl text-[color:var(--text-strong)] sm:text-3xl">Evidence-grounded chat</h1>
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
              disabled={!canRetryLatest}
              data-testid="retry-latest-response"
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-sm text-[color:var(--text-muted)] transition enabled:hover:border-[color:var(--border-strong)] enabled:hover:text-[color:var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void retryLatest()}
            >
              <Sparkles className="h-4 w-4" />
              Retry response
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
      {conversationMessages.error ? (
        <div className="mx-6 mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Saved transcript could not be loaded. Live chat is still available.
        </div>
      ) : null}

      <div
        ref={viewportRef}
        data-testid="chat-scrollport"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5"
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
            onRetry={retryMessage}
            showReasoningMetadata={showReasoningMetadata}
          />
        ) : localConversationId && conversationMessages.isLoading ? (
          <div className="flex h-full min-h-[18rem] items-center justify-center rounded-[2rem] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-6 text-center text-sm text-[color:var(--text-muted)] sm:min-h-[22rem] sm:p-10">
            Loading saved transcript…
          </div>
        ) : (
          <div className="flex h-full min-h-[18rem] flex-col items-center justify-center rounded-[2rem] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-6 text-center sm:min-h-[22rem] sm:p-10">
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

      <div data-testid="chat-composer-bar" className="shrink-0 border-t border-[color:var(--border-soft)] px-4 py-4 sm:px-6 sm:py-5">
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
