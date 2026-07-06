import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentLibrary } from '@/components/documents/document-library';
import type {
  DocumentRecord,
  WorkflowLookupState,
  WorkflowRecord,
} from '@/hooks/use-documents';

describe('DocumentLibrary', () => {
  afterEach(() => {
    cleanup();
  });

  it('disables each pending re-index independently and surfaces loading and error states', () => {
    const onReindex = vi.fn();

    render(
      createElement(DocumentLibrary, {
        documents: [
          {
            id: 'document_ready',
            uploadId: 'upload_1',
            status: 'READY',
            title: 'Quarterly Report',
            originalFilename: 'quarterly-report.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            chunkCount: 12,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
          {
            id: 'document_failed',
            uploadId: 'upload_3',
            status: 'FAILED',
            title: 'Vendor Checklist',
            originalFilename: 'vendor-checklist.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 4096,
            chunkCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
          {
            id: 'document_ingesting',
            uploadId: 'upload_2',
            status: 'INGESTING',
            title: 'Draft Contract',
            originalFilename: 'draft-contract.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 2048,
            chunkCount: 4,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        workflowsByDocumentId: new Map<string, WorkflowRecord>([
          [
            'document_ingesting',
            {
              id: 'workflow_1',
              workflowKey: 'ingestion',
              status: 'RUNNING',
              errorMessage: null,
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:10.000Z',
              startedAt: '2026-01-02T00:00:00.000Z',
              completedAt: null,
              uploadId: 'upload_2',
              documentId: 'document_ingesting',
              reconciliationRequired: false,
            },
          ],
        ]),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex,
        pendingReindexDocumentIds: new Set([
          'document_ready',
          'document_failed',
        ]),
        reindexError: 'Unable to queue re-index.',
      }),
    );

    const readyButton = screen.getByRole('button', {
      name: 'Re-index Quarterly Report',
    });
    const failedButton = screen.getByRole('button', {
      name: 'Re-index Vendor Checklist',
    });
    const ingestingButton = screen.getByRole('button', {
      name: 'Re-index Draft Contract',
    });

    expect(readyButton).toBeDisabled();
    expect(failedButton).toBeDisabled();
    expect(screen.getAllByText('Re-indexing…')).toHaveLength(2);
    expect(ingestingButton).toBeDisabled();
    expect(screen.getByText('Unable to queue re-index.')).toBeInTheDocument();

    fireEvent.click(readyButton);
    fireEvent.click(failedButton);
    expect(onReindex).not.toHaveBeenCalled();
  });

  it('triggers re-index for an eligible document', () => {
    const onReindex = vi.fn();

    render(
      createElement(DocumentLibrary, {
        documents: [
          {
            id: 'document_failed',
            uploadId: 'upload_3',
            status: 'FAILED',
            title: 'Vendor Checklist',
            originalFilename: 'vendor-checklist.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 4096,
            chunkCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        workflowsByDocumentId: new Map(),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex,
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Re-index Vendor Checklist' }),
    );

    expect(onReindex).toHaveBeenCalledWith('document_failed');
  });

  it('disables re-index and shows an unavailable workflow state when workflow lookup failed', () => {
    const onReindex = vi.fn();

    render(
      createElement(DocumentLibrary, {
        documents: [
          {
            id: 'document_failed',
            uploadId: 'upload_3',
            status: 'FAILED',
            title: 'Vendor Checklist',
            originalFilename: 'vendor-checklist.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 4096,
            chunkCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        workflowsByDocumentId: new Map(),
        workflowLookupStateByDocumentId: new Map<string, WorkflowLookupState>([
          ['document_failed', 'error'],
        ]),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex,
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
      }),
    );

    const button = screen.getByRole('button', {
      name: 'Re-index Vendor Checklist',
    });
    expect(button).toBeDisabled();
    expect(screen.getAllByText('Workflow unavailable').length).toBeGreaterThan(
      0,
    );

    fireEvent.click(button);

    expect(onReindex).not.toHaveBeenCalled();
  });

  it('renders real chunk counts instead of placeholder telemetry copy', () => {
    render(
      createElement(DocumentLibrary, {
        documents: [
          {
            id: 'document_ready',
            uploadId: 'upload_1',
            status: 'READY',
            title: 'Quarterly Report',
            originalFilename: 'quarterly-report.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            chunkCount: 12,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
          {
            id: 'document_empty',
            uploadId: 'upload_2',
            status: 'READY',
            title: 'Empty Notes',
            originalFilename: 'empty-notes.txt',
            mimeType: 'text/plain',
            fileSizeBytes: 12,
            chunkCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        workflowsByDocumentId: new Map(),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex: vi.fn(),
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
      }),
    );

    expect(screen.getAllByText('12 chunks')).toHaveLength(1);
    expect(screen.getAllByText('0 chunks').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('Pending pipeline telemetry'),
    ).not.toBeInTheDocument();
  });

  it('uses a sidebar-safe document card layout for long labels and action buttons', () => {
    render(
      createElement(DocumentLibrary, {
        documents: [
          {
            id: 'document_long',
            uploadId:
              'upload_with_a_very_long_identifier_that_should_wrap_inside_the_card',
            status: 'INGESTING',
            title: 'cymbal-starlight-2024',
            originalFilename: 'cymbal-starlight-2024.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 336748,
            chunkCount: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        workflowsByDocumentId: new Map<string, WorkflowRecord>([
          [
            'document_long',
            {
              id: 'workflow_1',
              workflowKey: 'ingestion',
              status: 'RUNNING',
              errorMessage: null,
              createdAt: '2026-01-02T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:10.000Z',
              startedAt: '2026-01-02T00:00:00.000Z',
              completedAt: null,
              uploadId:
                'upload_with_a_very_long_identifier_that_should_wrap_inside_the_card',
              documentId: 'document_long',
              reconciliationRequired: true,
            },
          ],
        ]),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex: vi.fn(),
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
      }),
    );

    expect(screen.getByTestId('document-card-document_long')).toHaveClass(
      'overflow-hidden',
    );
    expect(
      screen.getByTestId('document-card-body-document_long'),
    ).not.toHaveClass('xl:flex-row');
    expect(
      screen.getByTestId('document-metadata-grid-document_long'),
    ).not.toHaveClass('xl:grid-cols-4');
    expect(screen.getByTestId('document-actions-document_long')).toHaveClass(
      'grid-cols-2',
    );
    expect(screen.getByText('Linked upload ID:')).toBeInTheDocument();
    expect(
      screen.getByText(
        'upload_with_a_very_long_identifier_that_should_wrap_inside_the_card',
      ),
    ).toHaveClass('break-all');
  });

  it('shows paging controls and requests additional documents', () => {
    const onLoadMore = vi.fn();

    render(
      createElement(DocumentLibrary, {
        documents: [
          {
            id: 'document_ready',
            uploadId: 'upload_1',
            status: 'READY',
            title: 'Quarterly Report',
            originalFilename: 'quarterly-report.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            chunkCount: 12,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        workflowsByDocumentId: new Map(),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex: vi.fn(),
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
        totalDocuments: 48,
        hasMoreDocuments: true,
        onLoadMoreDocuments: onLoadMore,
        isLoadingMoreDocuments: false,
      }),
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Load more documents' }),
    );

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Showing 1 of 48 documents')).toBeInTheDocument();
  });

  it('renders accessible loading and error states for empty document results', () => {
    const { rerender } = render(
      createElement(DocumentLibrary, {
        documents: [],
        workflowsByDocumentId: new Map(),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex: vi.fn(),
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
        isLoadingDocuments: true,
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent('Loading documents…');
    expect(
      screen.queryByText(
        'No documents match the current knowledge-base filters.',
      ),
    ).not.toBeInTheDocument();

    rerender(
      createElement(DocumentLibrary, {
        documents: [],
        workflowsByDocumentId: new Map(),
        uploadHistory: [],
        search: '',
        statusFilter: 'ALL',
        sort: 'updatedAt',
        onSearchChange: vi.fn(),
        onStatusFilterChange: vi.fn(),
        onSortChange: vi.fn(),
        onDelete: vi.fn(),
        onReindex: vi.fn(),
        pendingReindexDocumentIds: new Set<string>(),
        reindexError: null,
        isLoadingDocuments: false,
        documentsError: 'Document library is unavailable.',
      }),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Document library is unavailable.',
    );
    expect(
      screen.queryByText(
        'No documents match the current knowledge-base filters.',
      ),
    ).not.toBeInTheDocument();
  });

  it('renders upload history loading and error states before falling back to empty copy', () => {
    const baseProps = {
      documents: [
        {
          id: 'document_ready',
          uploadId: 'upload_1',
          status: 'READY',
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          chunkCount: 12,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          deletedAt: null,
        },
      ] satisfies DocumentRecord[],
      workflowsByDocumentId: new Map<string, WorkflowRecord>(),
      uploadHistory: [],
      search: '',
      statusFilter: 'ALL' as const,
      sort: 'updatedAt' as const,
      onSearchChange: vi.fn(),
      onStatusFilterChange: vi.fn(),
      onSortChange: vi.fn(),
      onDelete: vi.fn(),
      onReindex: vi.fn(),
      pendingReindexDocumentIds: new Set<string>(),
      reindexError: null,
    };

    const view = render(
      createElement(DocumentLibrary, {
        ...baseProps,
        isLoadingUploadHistory: true,
      }),
    );

    expect(within(view.container).getByRole('status')).toHaveTextContent(
      'Loading upload history…',
    );
    expect(
      within(view.container).queryAllByText(
        'Upload history will populate once the public upload feed is available for this document.',
      ),
    ).toHaveLength(0);

    view.rerender(
      createElement(DocumentLibrary, {
        ...baseProps,
        isLoadingUploadHistory: false,
        uploadHistoryError: 'Upload history could not be loaded.',
      }),
    );

    expect(within(view.container).getByRole('alert')).toHaveTextContent(
      'Upload history could not be loaded.',
    );
    expect(
      within(view.container).queryAllByText(
        'Upload history will populate once the public upload feed is available for this document.',
      ),
    ).toHaveLength(0);
  });
});
