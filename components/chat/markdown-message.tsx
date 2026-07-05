'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      components={{
        table: ({ ...props }) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...props} />
          </div>
        ),
        th: ({ ...props }) => (
          <th
            className="border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-3 py-2 text-left font-semibold text-[color:var(--text-strong)]"
            {...props}
          />
        ),
        td: ({ ...props }) => (
          <td className="border border-[color:var(--border-soft)] px-3 py-2 text-[color:var(--text-muted)]" {...props} />
        ),
        code: ({ className, children, ...props }) => {
          const language = className?.replace('language-', '') ?? '';

          if (language === 'mermaid') {
            return (
              <div className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
                <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-dim)]">
                  Mermaid diagram
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap">{children}</pre>
              </div>
            );
          }

          if (language === 'math') {
            return (
              <div className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
                <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-dim)]">
                  Math
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap">{children}</pre>
              </div>
            );
          }

          return (
            <code
              className={[
                className ?? '',
                'rounded-lg bg-black/10 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/10',
              ].join(' ')}
              {...props}
            >
              {children}
            </code>
          );
        },
        pre: ({ ...props }) => (
          <pre
            className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--code-surface)] p-4 text-sm text-[color:var(--text-strong)]"
            {...props}
          />
        ),
        a: ({ ...props }) => <a className="text-[color:var(--accent)] underline underline-offset-4" {...props} />,
        p: ({ ...props }) => <p className="leading-7 text-[color:var(--text-muted)]" {...props} />,
        ul: ({ ...props }) => <ul className="list-disc space-y-2 pl-5 text-[color:var(--text-muted)]" {...props} />,
        ol: ({ ...props }) => <ol className="list-decimal space-y-2 pl-5 text-[color:var(--text-muted)]" {...props} />,
        blockquote: ({ ...props }) => (
          <blockquote className="border-l-2 border-[color:var(--accent)] pl-4 italic text-[color:var(--text-muted)]" {...props} />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
