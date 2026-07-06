'use client';

import type { UIMessage } from 'ai';
import { Copy, RefreshCw } from 'lucide-react';

import { StatusBadge } from '@/components/common/status-badge';
import { MarkdownMessage } from '@/components/chat/markdown-message';
import { getSafeCitationUrl } from '@/lib/chat/citation-url';

type ChatMessage = UIMessage<{
  model?: string;
  agent?: string;
  activeAgentName?: string;
  createdAt?: string;
}>;

type ToolPart = Extract<ChatMessage['parts'][number], { type: `tool-${string}` | 'dynamic-tool' }>;
type SourcePart = Extract<ChatMessage['parts'][number], { type: 'source-url' | 'source-document' }>;

function getTextContent(message: ChatMessage): string {
  return message.parts
    .filter((part): part is Extract<ChatMessage['parts'][number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('\n\n');
}

function getReasoningParts(message: ChatMessage) {
  return message.parts.filter(
    (part): part is Extract<ChatMessage['parts'][number], { type: 'reasoning' }> => part.type === 'reasoning',
  );
}

function getSourceParts(message: ChatMessage) {
  return message.parts.filter(
    (part): part is SourcePart => part.type === 'source-url' || part.type === 'source-document',
  );
}

function getSourceRenderKey(source: SourcePart) {
  const title = 'title' in source && typeof source.title === 'string' ? source.title : '';
  const url = 'url' in source && typeof source.url === 'string' ? source.url : '';
  const mediaType = 'mediaType' in source && typeof source.mediaType === 'string' ? source.mediaType : '';

  return [source.type, source.sourceId, title, url, mediaType].join('\u001f');
}

function getUniqueSourceParts(message: ChatMessage) {
  const uniqueSources: Array<{ key: string; source: SourcePart }> = [];
  const seen = new Set<string>();

  for (const source of getSourceParts(message)) {
    const key = getSourceRenderKey(source);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueSources.push({ key, source });
  }

  return uniqueSources;
}

function getToolParts(message: ChatMessage) {
  return message.parts.filter((part): part is ToolPart => part.type === 'dynamic-tool' || part.type.startsWith('tool-'));
}

function renderSourceUrl(url: string) {
  const safeUrl = getSafeCitationUrl(url);

  if (!safeUrl) {
    return <p className="mt-1 text-sm text-[color:var(--text-muted)]">{url}</p>;
  }

  return (
    <a href={safeUrl} className="mt-1 inline-block text-sm text-[color:var(--accent)] underline underline-offset-4">
      {url}
    </a>
  );
}

function humanizeToolName(name: string) {
  return name.replace(/^tool-/, '').replace(/[_-]+/g, ' ').trim();
}

function getToolStatusCopy(part: ToolPart) {
  switch (part.state) {
    case 'input-streaming':
    case 'input-available':
    case 'approval-requested':
    case 'approval-responded':
      return { label: 'running', tone: 'info' as const };
    case 'output-available':
      return { label: 'completed', tone: 'success' as const };
    case 'output-error':
    case 'output-denied':
      return { label: 'failed', tone: 'danger' as const };
    default:
      return null;
  }
}

export function MessageList({
  messages,
  onCopy,
  onRetry,
  showReasoningMetadata = true,
}: {
  messages: ChatMessage[];
  onCopy: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  showReasoningMetadata?: boolean;
}) {
  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const content = getTextContent(message);
        const reasoningParts = getReasoningParts(message);
        const sources = getUniqueSourceParts(message);
        const toolParts = getToolParts(message);
        const isAssistant = message.role === 'assistant';
        const timestamp = message.metadata?.createdAt
          ? new Date(message.metadata.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Live';

        return (
          <article
            key={message.id}
            data-testid={isAssistant ? 'assistant-message' : 'user-message'}
            className={[
              'rounded-[1.75rem] border p-5 shadow-[var(--shadow-panel)]',
              isAssistant
                ? 'border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)]'
                : 'border-[color:var(--accent-soft)] bg-[color:var(--accent-surface)]',
            ].join(' ')}
          >
            <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={message.role} tone={isAssistant ? 'info' : 'neutral'} />
                  {isAssistant && (message.metadata?.activeAgentName ?? message.metadata?.agent) ? (
                    <StatusBadge label={message.metadata?.activeAgentName ?? message.metadata?.agent ?? 'Assistant'} tone="success" />
                  ) : null}
                  {isAssistant && message.metadata?.model ? (
                    <StatusBadge label={message.metadata.model} tone="neutral" />
                  ) : null}
                </div>
                <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--text-dim)]">{timestamp}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-xs font-medium text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-strong)]"
                  aria-label="Copy message"
                  onClick={() => onCopy(message)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy message
                </button>
                {isAssistant ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-xs font-medium text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-strong)]"
                    onClick={() => onRetry(message)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry response
                  </button>
                ) : null}
              </div>
            </header>

            {content ? (
              <div data-testid="message-content">
                <MarkdownMessage content={content} />
              </div>
            ) : null}

            {toolParts.length > 0 ? (
              <section className="mt-5 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4">
                <p className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-dim)]">
                  Tool execution
                </p>
                <div className="space-y-2">
                  {toolParts.map((part) => {
                    const status = getToolStatusCopy(part);
                    if (!status) {
                      return null;
                    }

                    const toolName =
                      part.type === 'dynamic-tool' ? humanizeToolName(part.toolName) : humanizeToolName(part.type);
                    const ariaLabel = `Tool ${toolName} ${status.label}`;

                    return (
                      <div
                        key={part.toolCallId}
                        aria-label={ariaLabel}
                        className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-4 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium capitalize text-[color:var(--text-strong)]">{toolName}</p>
                            {part.state === 'output-error' && 'errorText' in part && part.errorText ? (
                              <p className="mt-1 text-xs text-rose-300">{part.errorText}</p>
                            ) : null}
                          </div>
                          <StatusBadge label={status.label} tone={status.tone} pulse={status.label === 'running'} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {sources.length > 0 ? (
              <section
                data-testid="message-citations"
                className="mt-5 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4"
              >
                <p className="mb-3 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-dim)]">
                  Citations
                </p>
                <div className="space-y-2">
                  {sources.map(({ key, source }) => (
                    <div
                      key={key}
                      data-testid="citation-item"
                      className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-4 py-3"
                    >
                       <p className="text-sm font-medium text-[color:var(--text-strong)]">
                         {'title' in source && source.title ? source.title : source.sourceId}
                       </p>
                       {'url' in source ? renderSourceUrl(source.url) : null}
                     </div>
                  ))}
                </div>
              </section>
            ) : null}

            {showReasoningMetadata && reasoningParts.length > 0 ? (
              <details className="mt-5 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4">
                <summary className="cursor-pointer text-sm font-medium text-[color:var(--text-strong)]">
                  Reasoning metadata
                </summary>
                <div className="mt-3 space-y-3 text-sm text-[color:var(--text-muted)]">
                  {reasoningParts.map((part, index) => (
                    <p key={`${message.id}-reasoning-${index}`}>{part.text}</p>
                  ))}
                </div>
              </details>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
