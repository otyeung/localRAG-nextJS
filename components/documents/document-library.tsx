'use client';

import { Database, RefreshCw, Search, Trash2 } from 'lucide-react';

import { StatusBadge } from '@/components/common/status-badge';
import type {
  DocumentRecord,
  WorkflowLookupState,
  WorkflowRecord,
} from '@/hooks/use-documents';
import type { UploadHistoryItem } from '@/hooks/use-upload-queue';

function formatBytes(bytes: number) {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  if (bytes < 1_048_576) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }

  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function statusTone(status: string) {
  switch (status) {
    case 'READY':
    case 'SUCCESS':
    case 'COMPLETED':
      return 'success';
    case 'FAILED':
    case 'ERROR':
      return 'danger';
    case 'INGESTING':
    case 'RUNNING':
    case 'WAITING':
      return 'info';
    default:
      return 'neutral';
  }
}

function sortLabel(sort: 'createdAt' | 'updatedAt' | 'title') {
  return sort === 'title'
    ? 'Title'
    : sort === 'createdAt'
      ? 'Created'
      : 'Updated';
}

function formatChunkCount(chunkCount: number) {
  return `${chunkCount} ${chunkCount === 1 ? 'chunk' : 'chunks'}`;
}

function workflowStatusLabel(
  workflow: WorkflowRecord | undefined,
  lookupState: WorkflowLookupState,
) {
  if (lookupState === 'error') {
    return 'Workflow unavailable';
  }

  if (lookupState === 'loading') {
    return 'Checking workflow';
  }

  return workflow?.status ?? 'Workflow pending';
}

function workflowStatusDescription(
  workflow: WorkflowRecord | undefined,
  lookupState: WorkflowLookupState,
) {
  if (lookupState === 'error') {
    return 'Workflow unavailable';
  }

  if (lookupState === 'loading') {
    return 'Checking workflow status';
  }

  return workflow?.status ?? 'Waiting for workflow route';
}

function canReindexDocument(
  document: DocumentRecord,
  workflow: WorkflowRecord | undefined,
  workflowLookupState: WorkflowLookupState,
) {
  if (document.deletedAt) {
    return false;
  }

  if (document.status === 'PENDING' || document.status === 'INGESTING') {
    return false;
  }

  if (workflowLookupState !== 'ready') {
    return false;
  }

  return (
    workflow?.status !== 'RUNNING' &&
    workflow?.status !== 'WAITING' &&
    workflow?.status !== 'QUEUED'
  );
}

export function DocumentLibrary({
  documents,
  totalDocuments = documents.length,
  hasMoreDocuments = false,
  onLoadMoreDocuments,
  isLoadingMoreDocuments = false,
  isLoadingDocuments = false,
  documentsError = null,
  workflowsByDocumentId,
  workflowLookupStateByDocumentId,
  uploadHistory,
  isLoadingUploadHistory = false,
  uploadHistoryError = null,
  search,
  statusFilter,
  sort,
  onSearchChange,
  onStatusFilterChange,
  onSortChange,
  onDelete,
  onReindex,
  pendingReindexDocumentIds,
  reindexError,
}: {
  documents: DocumentRecord[];
  totalDocuments?: number;
  hasMoreDocuments?: boolean;
  onLoadMoreDocuments?: () => void;
  isLoadingMoreDocuments?: boolean;
  isLoadingDocuments?: boolean;
  documentsError?: string | null;
  workflowsByDocumentId: Map<string, WorkflowRecord>;
  workflowLookupStateByDocumentId?: Map<string, WorkflowLookupState>;
  uploadHistory: UploadHistoryItem[];
  isLoadingUploadHistory?: boolean;
  uploadHistoryError?: string | null;
  search: string;
  statusFilter: 'ALL' | 'PENDING' | 'INGESTING' | 'READY' | 'FAILED';
  sort: 'createdAt' | 'updatedAt' | 'title';
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (
    value: 'ALL' | 'PENDING' | 'INGESTING' | 'READY' | 'FAILED',
  ) => void;
  onSortChange: (value: 'createdAt' | 'updatedAt' | 'title') => void;
  onDelete: (id: string) => void;
  onReindex: (id: string) => void;
  pendingReindexDocumentIds: ReadonlySet<string>;
  reindexError: string | null;
}) {
  return (
    <section className="space-y-4">
      <div className="rounded-[1.75rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--text-strong)]">
              Document library
            </h3>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Search indexed files, inspect ingestion workflow state, and queue
              follow-up actions from one pane.
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.16em] text-[color:var(--text-dim)]">
              Showing {documents.length} of {totalDocuments} documents
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="relative min-w-[11rem] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--text-dim)]" />
              <input
                value={search}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder="Search documents"
                className="w-full min-w-0 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] py-2.5 pl-9 pr-4 text-sm text-[color:var(--text-strong)] outline-none placeholder:text-[color:var(--text-dim)] focus:border-[color:var(--accent)]"
              />
            </label>
            <select
              value={statusFilter}
              onChange={(event) =>
                onStatusFilterChange(
                  event.target.value as
                    'ALL' | 'PENDING' | 'INGESTING' | 'READY' | 'FAILED',
                )
              }
              className="min-w-[5.75rem] rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-3 py-2.5 text-sm text-[color:var(--text-strong)] outline-none focus:border-[color:var(--accent)]"
            >
              <option value="ALL">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="INGESTING">Ingesting</option>
              <option value="READY">Ready</option>
              <option value="FAILED">Failed</option>
            </select>
            <select
              value={sort}
              onChange={(event) =>
                onSortChange(
                  event.target.value as 'createdAt' | 'updatedAt' | 'title',
                )
              }
              className="min-w-[5.75rem] rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-3 py-2.5 text-sm text-[color:var(--text-strong)] outline-none focus:border-[color:var(--accent)]"
            >
              <option value="updatedAt">Updated</option>
              <option value="createdAt">Created</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>
      </div>
      {reindexError ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {reindexError}
        </div>
      ) : null}

      <div className="space-y-3">
        {documents.length > 0 ? (
          <>
            {documents.map((document) => {
              const workflow = workflowsByDocumentId.get(document.id);
              const workflowLookupState =
                workflowLookupStateByDocumentId?.get(document.id) ?? 'ready';
              const relatedUploads = uploadHistory.filter(
                (upload) => upload.id === document.uploadId,
              );
              const canReindex = canReindexDocument(
                document,
                workflow,
                workflowLookupState,
              );
              const isReindexing = pendingReindexDocumentIds.has(document.id);

              return (
                <article
                  key={document.id}
                  data-testid={`document-card-${document.id}`}
                  aria-label={`Document ${document.originalFilename}`}
                  className="overflow-hidden rounded-[1.75rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] p-5 shadow-[var(--shadow-panel)]"
                >
                  <div
                    data-testid={`document-card-body-${document.id}`}
                    className="grid min-w-0 gap-4"
                  >
                    <div className="min-w-0 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-3 text-[color:var(--text-muted)]">
                          <Database className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h4 className="break-words text-base font-semibold text-[color:var(--text-strong)]">
                            {document.title}
                          </h4>
                          <p className="break-all text-sm text-[color:var(--text-muted)]">
                            {document.originalFilename}
                          </p>
                        </div>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <StatusBadge
                          label={document.status}
                          tone={statusTone(document.status)}
                        />
                        <StatusBadge
                          label={workflowStatusLabel(
                            workflow,
                            workflowLookupState,
                          )}
                          tone={
                            workflowLookupState === 'error'
                              ? 'warning'
                              : workflow
                                ? statusTone(workflow.status)
                                : 'neutral'
                          }
                        />
                        <StatusBadge label={sortLabel(sort)} tone="neutral" />
                      </div>

                      <dl
                        data-testid={`document-metadata-grid-${document.id}`}
                        className="grid min-w-0 gap-3 min-[360px]:grid-cols-2"
                      >
                        <div className="min-w-0">
                          <dt className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-dim)]">
                            Metadata
                          </dt>
                          <dd className="mt-1 break-words text-sm text-[color:var(--text-strong)]">
                            {document.mimeType} ·{' '}
                            {formatBytes(document.fileSizeBytes)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-dim)]">
                            Chunk count
                          </dt>
                          <dd className="mt-1 text-sm text-[color:var(--text-strong)]">
                            {Number.isFinite(document.chunkCount) &&
                            document.chunkCount >= 0
                              ? formatChunkCount(document.chunkCount)
                              : 'Unknown'}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-dim)]">
                            Embedding status
                          </dt>
                          <dd className="mt-1 text-sm text-[color:var(--text-strong)]">
                            {document.status === 'READY'
                              ? 'Indexed'
                              : document.status === 'FAILED'
                                ? 'Attention'
                                : 'Processing'}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[0.68rem] uppercase tracking-[0.18em] text-[color:var(--text-dim)]">
                            Workflow status
                          </dt>
                          <dd className="mt-1 break-words text-sm text-[color:var(--text-strong)]">
                            {workflowStatusDescription(
                              workflow,
                              workflowLookupState,
                            )}
                          </dd>
                        </div>
                      </dl>

                      <div className="rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-[color:var(--text-strong)]">
                              Upload history
                            </p>
                            <p className="text-xs text-[color:var(--text-dim)]">
                              <span>Linked upload ID: </span>
                              <span className="break-all">
                                {document.uploadId}
                              </span>
                            </p>
                          </div>
                          {workflow?.reconciliationRequired ? (
                            <StatusBadge
                              label="Needs reconciliation"
                              tone="warning"
                            />
                          ) : null}
                        </div>
                        <div className="mt-3 space-y-2">
                          {isLoadingUploadHistory ? (
                            <div
                              role="status"
                              aria-live="polite"
                              className="rounded-2xl border border-dashed border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-4 py-3 text-sm text-[color:var(--text-muted)]"
                            >
                              Loading upload history…
                            </div>
                          ) : uploadHistoryError ? (
                            <div
                              role="alert"
                              className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300"
                            >
                              {uploadHistoryError}
                            </div>
                          ) : relatedUploads.length > 0 ? (
                            relatedUploads.map((upload) => (
                              <div
                                key={upload.id}
                                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-[color:var(--border-soft)] bg-[color:var(--panel-elevated)] px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="break-all text-sm font-medium text-[color:var(--text-strong)]">
                                    {upload.originalFilename}
                                  </p>
                                  <p className="text-xs text-[color:var(--text-dim)]">
                                    {new Date(
                                      upload.updatedAt,
                                    ).toLocaleString()}
                                  </p>
                                </div>
                                <StatusBadge
                                  label={upload.status}
                                  tone={statusTone(upload.status)}
                                />
                              </div>
                            ))
                          ) : (
                            <p className="text-sm text-[color:var(--text-muted)]">
                              Upload history will populate once the public
                              upload feed is available for this document.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      data-testid={`document-actions-${document.id}`}
                      className="grid grid-cols-2 gap-2"
                    >
                      <button
                        type="button"
                        aria-label={`Re-index ${document.title}`}
                        disabled={!canReindex || isReindexing}
                        className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-[color:var(--border-soft)] px-3 py-2 text-sm font-medium text-[color:var(--text-muted)] transition enabled:hover:border-[color:var(--border-strong)] enabled:hover:text-[color:var(--text-strong)] disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onReindex(document.id)}
                      >
                        <RefreshCw
                          className={[
                            'h-4 w-4',
                            isReindexing ? 'animate-spin' : '',
                          ].join(' ')}
                        />
                        {isReindexing ? 'Re-indexing…' : 'Re-index'}
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-rose-500/30 px-3 py-2 text-sm font-medium text-rose-300 transition hover:border-rose-400/40"
                        onClick={() => onDelete(document.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {hasMoreDocuments ? (
              <button
                type="button"
                className="w-full rounded-[1.75rem] border border-[color:var(--border-soft)] bg-[color:var(--panel-subtle)] px-4 py-3 text-sm font-medium text-[color:var(--text-strong)] transition hover:border-[color:var(--accent)] disabled:cursor-wait disabled:opacity-70"
                onClick={onLoadMoreDocuments}
                disabled={isLoadingMoreDocuments}
              >
                {isLoadingMoreDocuments
                  ? 'Loading more…'
                  : 'Load more documents'}
              </button>
            ) : null}
          </>
        ) : isLoadingDocuments ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-[1.75rem] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-6 text-sm text-[color:var(--text-muted)]"
          >
            Loading documents…
          </div>
        ) : documentsError ? (
          <div
            role="alert"
            className="rounded-[1.75rem] border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-300"
          >
            {documentsError}
          </div>
        ) : (
          <div className="rounded-[1.75rem] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--panel-subtle)] p-6 text-sm text-[color:var(--text-muted)]">
            No documents match the current knowledge-base filters.
          </div>
        )}
      </div>
    </section>
  );
}
