'use client';

import { useState } from 'react';
import { CircleX, RefreshCw, UploadCloud } from 'lucide-react';

import { StatusBadge } from '@/components/common/status-badge';
import type { UploadQueueItem } from '@/hooks/use-upload-queue';

function formatBytes(bytes: number) {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }

  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function queueTone(status: UploadQueueItem['status']) {
  switch (status) {
    case 'success':
      return 'success';
    case 'error':
      return 'danger';
    case 'uploading':
      return 'info';
    case 'canceled':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function UploadDropzone({
  queue,
  onFilesSelected,
  onCancel,
  onRetry,
}: {
  queue: UploadQueueItem[];
  onFilesSelected: (files: FileList | File[]) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <section className="space-y-4">
      <div
        className={[
          'rounded-[1.75rem] border border-dashed p-5 transition',
          isDragging
            ? 'border-[color:var(--accent)] bg-[color:var(--accent-surface)]'
            : 'border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)]',
        ].join(' ')}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (event.dataTransfer.files.length > 0) {
            onFilesSelected(event.dataTransfer.files);
          }
        }}
      >
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <span className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-3 text-[color:var(--text-muted)]">
              <UploadCloud className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-semibold text-[color:var(--text-strong)]">Upload documents</h3>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
                Drag private files into the intake lane or browse from disk. Supported formats mirror the ingestion service: PDF, DOCX, TXT, MD, CSV, XLSX, PPTX, JSON, HTML, PNG, JPG, and ZIP.
              </p>
            </div>
          </div>
          <label
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-4 py-2 text-sm font-medium text-[color:var(--text-strong)] transition hover:border-[color:var(--accent)]"
            htmlFor="upload-browse-files"
          >
            Browse
            <input
              id="upload-browse-files"
              aria-label="Browse files"
              multiple
              type="file"
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) {
                  onFilesSelected(event.target.files);
                }

                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </div>

      <div className="space-y-3">
        {queue.length > 0 ? (
          queue.map((item) => (
            <article
              key={item.id}
              className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-[color:var(--text-strong)]">{item.fileName}</p>
                    <StatusBadge label={item.status} tone={queueTone(item.status)} />
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--text-dim)]">{formatBytes(item.size)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {item.status === 'error' ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-xs font-medium text-[color:var(--text-muted)] transition hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-strong)]"
                      aria-label={`Retry upload for ${item.fileName}`}
                      onClick={() => onRetry(item.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </button>
                  ) : null}
                  {item.status === 'uploading' ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-300 transition hover:border-rose-400/40"
                      aria-label={`Cancel upload for ${item.fileName}`}
                      onClick={() => onCancel(item.id)}
                    >
                      <CircleX className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-[color:var(--accent)] transition-all"
                  style={{ width: `${Math.max(item.progress, item.status === 'success' ? 100 : 6)}%` }}
                />
              </div>

              {item.errorMessage ? (
                <p className="mt-3 text-sm text-rose-300">{item.errorMessage}</p>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4 text-sm text-[color:var(--text-muted)]">
            No files in the upload queue.
          </div>
        )}
      </div>
    </section>
  );
}
