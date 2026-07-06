'use client';

import { LoaderCircle, SendHorizontal, Square } from 'lucide-react';

export function MessageComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  disabled = false,
  isStreaming = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
}) {
  return (
    <div className="rounded-[1.5rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-3 shadow-[var(--shadow-panel)] sm:rounded-[1.75rem]">
      <label className="sr-only" htmlFor="message-input">
        Message input
      </label>
      <textarea
        id="message-input"
        aria-label="Message input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Interrogate your private corpus with grounded prompts, tables, and follow-up reasoning."
        className="max-h-40 min-h-20 w-full resize-none bg-transparent px-3 py-2 text-sm leading-7 text-[color:var(--text-strong)] outline-none placeholder:text-[color:var(--text-dim)] sm:min-h-28"
      />
      <div className="mt-3 flex flex-col gap-3 border-t border-[color:var(--border-soft)] px-2 pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <p className="text-xs text-[color:var(--text-dim)] sm:max-w-[60%]">
          Shift+Enter for a newline. Responses stream into the transcript with citations and metadata.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <button
            type="button"
            onClick={onStop}
            disabled={!isStreaming}
            data-testid="stop-generation"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-sm text-[color:var(--text-muted)] transition enabled:hover:border-[color:var(--border-strong)] enabled:hover:text-[color:var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Square className="h-3.5 w-3.5" />
            Stop generation
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-foreground)] transition enabled:hover:translate-y-[-1px] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isStreaming ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            Send message
          </button>
        </div>
      </div>
    </div>
  );
}
