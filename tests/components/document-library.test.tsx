import '@testing-library/jest-dom/vitest';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentLibrary } from '@/components/documents/document-library';
import type { WorkflowRecord } from '@/hooks/use-documents';

describe('DocumentLibrary', () => {
  it('enables re-index for eligible documents and surfaces loading and error states', () => {
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
        reindexingDocumentId: 'document_ready',
        reindexError: 'Unable to queue re-index.',
      }),
    );

    const readyButton = screen.getByRole('button', { name: 'Re-index Quarterly Report' });
    const ingestingButton = screen.getByRole('button', { name: 'Re-index Draft Contract' });

    expect(readyButton).toBeDisabled();
    expect(screen.getByText('Re-indexing…')).toBeInTheDocument();
    expect(ingestingButton).toBeDisabled();
    expect(screen.getByText('Unable to queue re-index.')).toBeInTheDocument();

    fireEvent.click(readyButton);
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
        reindexingDocumentId: null,
        reindexError: null,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-index Vendor Checklist' }));

    expect(onReindex).toHaveBeenCalledWith('document_failed');
  });
});
