'use client';

import { Children, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type CustomBlockKind = 'mermaid' | 'math';

function hasClassToken(className: string | undefined, token: string) {
  return className?.split(/\s+/).includes(token) ?? false;
}

function getCustomBlockMetadata(children: ReactNode): { kind: CustomBlockKind; content: string } | null {
  const [firstChild] = Children.toArray(children);

  if (!isValidElement<{ className?: string; children?: ReactNode }>(firstChild)) {
    return null;
  }

  const className = typeof firstChild.props.className === 'string' ? firstChild.props.className : '';
  const kind = className === 'language-mermaid' ? 'mermaid' : className === 'language-math' ? 'math' : null;

  if (!kind) {
    return null;
  }

  const content = Children.toArray(firstChild.props.children)
    .map((child) => (typeof child === 'string' ? child : ''))
    .join('');

  return { kind, content: content.replace(/\n$/, '') };
}

function BlockPreview({ kind, content }: { kind: CustomBlockKind; content: string }) {
  const heading = kind === 'mermaid' ? 'Mermaid diagram' : 'Math';

  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
      <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-dim)]">{heading}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap">
        <code>{content}</code>
      </pre>
    </div>
  );
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
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
        code: ({ className, children, ...props }) =>
          className ? (
            <code className={className} {...props}>
              {children}
            </code>
          ) : (
            <code
              className="rounded-lg bg-black/10 px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/10"
              {...props}
            >
              {children}
            </code>
          ),
        pre: ({ children, ...props }) => {
          const customBlock = getCustomBlockMetadata(children);

          if (customBlock) {
            return <BlockPreview kind={customBlock.kind} content={customBlock.content} />;
          }

          return (
            <pre
              className="overflow-x-auto rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--code-surface)] p-4 text-sm text-[color:var(--text-strong)]"
              {...props}
            >
              {children}
            </pre>
          );
        },
        span: ({ className, children, ...props }) => {
          if (hasClassToken(className, 'katex-display') || hasClassToken(className, 'math-display')) {
            return (
              <div className="rounded-2xl border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
                <p className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[color:var(--text-dim)]">Math</p>
                <span className={className} {...props}>
                  {children}
                </span>
              </div>
            );
          }

          return (
            <span className={className} {...props}>
              {children}
            </span>
          );
        },
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
