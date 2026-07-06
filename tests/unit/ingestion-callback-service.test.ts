import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));

import { DocumentStatus, UploadStatus, WorkflowStatus } from '@prisma/client';

import { IngestionCallbackService } from '@/lib/services/ingestion-callback-service';

describe('IngestionCallbackService', () => {
  it('persists completed chunks and marks upload, document, and workflow complete', async () => {
    const completedAt = new Date('2026-07-06T06:05:00.000Z');
    const transaction = {
      chunkMetadata: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      embeddingMetadata: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      upload: {
        update: vi.fn().mockResolvedValue({
          id: 'upload_1',
          status: UploadStatus.COMPLETED,
        }),
      },
      document: {
        update: vi.fn().mockResolvedValue({
          id: 'document_1',
          status: DocumentStatus.READY,
        }),
      },
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.SUCCESS,
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.INGESTING,
          title: 'Cymbal Starlight 2024',
          originalFilename: 'cymbal-starlight-2024.pdf',
          metadata: {
            existing: true,
          },
          deletedAt: null,
        }),
      },
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          metadata: {
            workflowId: 'workflow-ingestion',
            reconciliationRequired: true,
            reconciliationSource: 'n8n_poll',
          },
        }),
      },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const service = new IngestionCallbackService({ db: db as never });

    await expect(
      service.completeIngestion({
        documentId: 'document_1',
        uploadId: 'upload_1',
        externalExecutionId: '22',
        workflowId: 'workflow-ingestion',
        completedAt: completedAt.toISOString(),
        embeddingModel: 'nomic-embed-text',
        chunks: [
          {
            chunkIndex: 1,
            content: 'Cargo\u0000capacity is 13.5 cubic feet.',
            tokenCount: 9,
            pointId: 'point_1',
          },
          {
            chunkIndex: 0,
            content: 'The Cymbal Starlight is a compact vehicle.',
            tokenCount: 10,
            pointId: 'point_0',
          },
        ],
      }),
    ).resolves.toEqual({
      documentId: 'document_1',
      uploadId: 'upload_1',
      workflowExecutionId: 'workflow_1',
      status: 'READY',
      chunkCount: 2,
    });

    expect(db.document.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'document_1',
        uploadId: 'upload_1',
        deletedAt: null,
      },
    });
    expect(db.workflowExecution.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        workflowKey: 'ingestion',
        externalExecutionId: '22',
        OR: [{ documentId: 'document_1' }, { uploadId: 'upload_1' }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(transaction.chunkMetadata.deleteMany).toHaveBeenCalledWith({
      where: { documentId: 'document_1' },
    });
    expect(transaction.chunkMetadata.createMany).toHaveBeenCalledWith({
      data: [
        {
          documentId: 'document_1',
          chunkIndex: 0,
          content: 'The Cymbal Starlight is a compact vehicle.',
          tokenCount: 10,
          metadata: {
            ingestionCallback: true,
            pointId: 'point_0',
          },
        },
        {
          documentId: 'document_1',
          chunkIndex: 1,
          content: 'Cargo capacity is 13.5 cubic feet.',
          tokenCount: 9,
          metadata: {
            ingestionCallback: true,
            pointId: 'point_1',
          },
        },
      ],
    });
    expect(transaction.embeddingMetadata.createMany).toHaveBeenCalledWith({
      data: [
        {
          documentId: 'document_1',
          chunkId: null,
          vectorStoreId: 'point_0',
          embeddingModel: 'nomic-embed-text',
          dimensions: null,
          metadata: {
            ingestionCallback: true,
            chunkIndex: 0,
          },
        },
        {
          documentId: 'document_1',
          chunkId: null,
          vectorStoreId: 'point_1',
          embeddingModel: 'nomic-embed-text',
          dimensions: null,
          metadata: {
            ingestionCallback: true,
            chunkIndex: 1,
          },
        },
      ],
    });
    expect(transaction.upload.update).toHaveBeenCalledWith({
      where: { id: 'upload_1' },
      data: {
        status: UploadStatus.COMPLETED,
        errorMessage: null,
      },
    });
    expect(transaction.document.update).toHaveBeenCalledWith({
      where: { id: 'document_1' },
      data: {
        status: DocumentStatus.READY,
        extractedText:
          'The Cymbal Starlight is a compact vehicle.\n\nCargo capacity is 13.5 cubic feet.',
        searchText:
          'Cymbal Starlight 2024\ncymbal-starlight-2024.pdf\nThe Cymbal Starlight is a compact vehicle.\n\nCargo capacity is 13.5 cubic feet.',
        metadata: {
          existing: true,
          ingestionCallback: {
            completedAt: '2026-07-06T06:05:00.000Z',
            chunkCount: 2,
            externalExecutionId: '22',
            workflowId: 'workflow-ingestion',
          },
        },
      },
    });
    expect(transaction.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'workflow_1' },
      data: {
        status: WorkflowStatus.SUCCESS,
        errorMessage: null,
        completedAt,
        responsePayload: {
          chunkCount: 2,
          pointIds: ['point_0', 'point_1'],
        },
        metadata: {
          workflowId: 'workflow-ingestion',
          reconciliationRequired: false,
          ingestionCallbackAt: '2026-07-06T06:05:00.000Z',
          chunkCount: 2,
        },
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'ingestion.completed',
        entityType: 'document',
        entityId: 'document_1',
        metadata: {
          uploadId: 'upload_1',
          workflowExecutionId: 'workflow_1',
          externalExecutionId: '22',
          chunkCount: 2,
        },
      },
    });
  });

  it('falls back to the latest active workflow when n8n reports an execution id the app did not create', async () => {
    const transaction = {
      chunkMetadata: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      embeddingMetadata: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      upload: {
        update: vi.fn().mockResolvedValue({ id: 'upload_1' }),
      },
      document: {
        update: vi.fn().mockResolvedValue({ id: 'document_1' }),
      },
      workflowExecution: {
        update: vi.fn().mockResolvedValue({ id: 'workflow_running' }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.INGESTING,
          title: 'Report',
          originalFilename: 'report.pdf',
          metadata: null,
          deletedAt: null,
        }),
      },
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'workflow_running',
          metadata: null,
        }),
      },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const service = new IngestionCallbackService({ db: db as never });

    await service.completeIngestion({
      documentId: 'document_1',
      uploadId: 'upload_1',
      externalExecutionId: 'new-direct-execution',
      chunks: [{ chunkIndex: 0, content: 'Done.', tokenCount: 2 }],
    });

    expect(db.workflowExecution.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        userId: 'user_1',
        workflowKey: 'ingestion',
        OR: [{ documentId: 'document_1' }, { uploadId: 'upload_1' }],
        status: {
          in: [WorkflowStatus.QUEUED, WorkflowStatus.RUNNING, WorkflowStatus.WAITING],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(transaction.workflowExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'workflow_running' },
      }),
    );
  });

  it('bounds denormalized document search text while preserving complete chunk text', async () => {
    const transaction = {
      chunkMetadata: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      embeddingMetadata: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      upload: {
        update: vi.fn().mockResolvedValue({ id: 'upload_1' }),
      },
      document: {
        update: vi.fn().mockResolvedValue({ id: 'document_1' }),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.INGESTING,
          title: 'Long Report',
          originalFilename: 'long-report.pdf',
          metadata: null,
          deletedAt: null,
        }),
      },
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
        callback(transaction),
      ),
    };
    const longContent = 'a'.repeat(9_000);
    const service = new IngestionCallbackService({ db: db as never });

    await service.completeIngestion({
      documentId: 'document_1',
      uploadId: 'upload_1',
      chunks: [{ chunkIndex: 0, content: longContent, tokenCount: 2 }],
    });

    expect(transaction.chunkMetadata.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          content: longContent,
        }),
      ],
    });
    expect(transaction.document.update).toHaveBeenCalledWith({
      where: { id: 'document_1' },
      data: expect.objectContaining({
        searchText: expect.stringMatching(/^Long Report\nlong-report\.pdf\n/),
      }),
    });
    const updateInput = transaction.document.update.mock.calls[0][0] as {
      data: { searchText: string };
    };
    expect(updateInput.data.searchText.length).toBeLessThanOrEqual(4_000);
  });

  it('rejects duplicate chunk indexes before mutating local state', async () => {
    const db = {
      document: {
        findFirst: vi.fn(),
      },
      workflowExecution: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    const service = new IngestionCallbackService({ db: db as never });

    await expect(
      service.completeIngestion({
        documentId: 'document_1',
        uploadId: 'upload_1',
        chunks: [
          { chunkIndex: 0, content: 'First.' },
          { chunkIndex: 0, content: 'Duplicate.' },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Ingestion callback chunks must have unique indexes.',
    });

    expect(db.document.findFirst).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
