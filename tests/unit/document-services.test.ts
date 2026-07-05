import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));

import { DocumentStatus, UploadStatus, WorkflowStatus } from '@prisma/client';

import { UploadService } from '@/lib/services/upload-service';
import { DocumentService } from '@/lib/services/document-service';
import { WorkflowService } from '@/lib/services/workflow-service';

const uploadTestDirectory = resolve(
  '/Users/dyeung/repo/technology_learning/056-RAG/localRAG-nextJS',
  'test-results/upload-service',
);

describe('document services', () => {
  beforeEach(() => {
    rmSync(uploadTestDirectory, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(uploadTestDirectory, { recursive: true, force: true });
  });

  it('creates an upload, document, and workflow execution before starting ingestion', async () => {
    const acceptedTx = {
      upload: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      document: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      workflowExecution: {
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation(async (callback: (transaction: typeof acceptedTx) => Promise<unknown>) =>
        callback(acceptedTx),
      ),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const validationService = {
      validate: vi.fn().mockResolvedValue({
        normalizedExtension: 'pdf',
        normalizedMimeType: 'application/pdf',
      }),
    };
    const virusScanService = {
      scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn().mockResolvedValue({
        executionId: 'exec_123',
        workflowId: 'workflow_123',
        status: 'running',
      }),
    };
    const service = new UploadService({
      db: db as never,
      validationService: validationService as never,
      virusScanService: virusScanService as never,
      ingestionService: ingestionService as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    const result = await service.createUpload({
      userId: 'user_1',
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      bytes: Buffer.from('hello world'),
      requestId: 'req_upload',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    const startedUpload = ingestionService.startDocumentIngestion.mock.calls[0][0];

    expect(result).toMatchObject({
      uploadId: startedUpload.uploadId,
      documentId: startedUpload.documentId,
      workflowExecutionId: expect.any(String),
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
      reconciliationRequired: false,
    });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(validationService.validate).toHaveBeenCalledWith({
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      size: 11,
    });
    expect(virusScanService.scanFile).toHaveBeenCalledWith(expect.stringContaining(uploadTestDirectory));
    expect(ingestionService.startDocumentIngestion).toHaveBeenCalledWith({
      documentId: startedUpload.documentId,
      uploadId: startedUpload.uploadId,
      filePath: expect.stringContaining(uploadTestDirectory),
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      requestId: 'req_upload',
    });
    expect(acceptedTx.upload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: startedUpload.uploadId,
        userId: 'user_1',
        status: UploadStatus.INGESTING,
      }),
    });
    expect(acceptedTx.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: startedUpload.documentId,
        uploadId: startedUpload.uploadId,
        status: DocumentStatus.INGESTING,
      }),
    });
    expect(acceptedTx.workflowExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: result.workflowExecutionId,
        uploadId: startedUpload.uploadId,
        documentId: startedUpload.documentId,
        externalExecutionId: 'exec_123',
        status: WorkflowStatus.RUNNING,
        metadata: {
          workflowId: 'workflow_123',
        },
      }),
    });
    expect(acceptedTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'upload.created',
        entityType: 'upload',
        entityId: startedUpload.uploadId,
        requestId: 'req_upload',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        metadata: expect.objectContaining({
          documentId: startedUpload.documentId,
          workflowExecutionId: result.workflowExecutionId,
        }),
      },
    });
    expect(existsSync(result.storagePath)).toBe(true);
  });
  it('removes persisted temp files when ingestion fails before any local upload rows are created', async () => {
    const db = {
      $transaction: vi.fn(),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    await expect(
      service.createUpload({
        userId: 'user_1',
        fileName: 'Quarterly Report.PDF',
        mimeType: 'application/pdf',
        bytes: Buffer.from('hello world'),
      }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledOnce();
    expect(existsSync(uploadTestDirectory)).toBe(true);
    expect(readdirSync(uploadTestDirectory)).toHaveLength(0);
  });
  it('records an audit event when ingestion fails to start before local upload rows are created', async () => {
    const db = {
      $transaction: vi.fn(),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    await expect(
      service.createUpload({
        userId: 'user_1',
        fileName: 'Quarterly Report.PDF',
        mimeType: 'application/pdf',
        bytes: Buffer.from('hello world'),
        requestId: 'req_upload',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    ).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'upload.ingestion_start_failed',
        entityType: 'upload',
        entityId: expect.any(String),
        requestId: 'req_upload',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        metadata: {
          documentId: expect.any(String),
          workflowExecutionId: expect.any(String),
          error: 'n8n unavailable',
        },
      },
    });
  });
  it('fails the upload start-failure audit when the audit write fails', async () => {
    const db = {
      $transaction: vi.fn(),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error('audit write failed')),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    await expect(
      service.createUpload({
        userId: 'user_1',
        fileName: 'Quarterly Report.PDF',
        mimeType: 'application/pdf',
        bytes: Buffer.from('hello world'),
      }),
    ).rejects.toThrow('audit write failed');

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });
  it('does not leave unrecoverable initial-state upload rows when start-failure audit persistence fails', async () => {
    const db = {
      $transaction: vi.fn(),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error('audit write failed')),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    await expect(
      service.createUpload({
        userId: 'user_1',
        fileName: 'Quarterly Report.PDF',
        mimeType: 'application/pdf',
        bytes: Buffer.from('hello world'),
      }),
    ).rejects.toThrow('audit write failed');

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.upload.update).not.toHaveBeenCalled();
    expect(db.document.update).not.toHaveBeenCalled();
    expect(db.workflowExecution.update).not.toHaveBeenCalled();
    expect(existsSync(uploadTestDirectory)).toBe(true);
    expect(readdirSync(uploadTestDirectory)).toHaveLength(0);
  });
  it('returns reconciliation-needed upload handles when post-start persistence fails after n8n accepts the upload', async () => {
    const acceptedStatusError = new Error('audit write failed');
    const reconciliationTx = {
      upload: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      document: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      workflowExecution: {
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(acceptedStatusError)
        .mockImplementationOnce(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
          callback(reconciliationTx),
        ),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockResolvedValue({
          executionId: 'exec_123',
          workflowId: 'workflow_123',
          status: 'running',
        }),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    await expect(
      service.createUpload({
        userId: 'user_1',
        fileName: 'Quarterly Report.PDF',
        mimeType: 'application/pdf',
        bytes: Buffer.from('hello world'),
      }),
    ).resolves.toMatchObject({
      uploadId: expect.any(String),
      documentId: expect.any(String),
      workflowExecutionId: expect.any(String),
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
      reconciliationRequired: true,
    });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(reconciliationTx.upload.create).toHaveBeenCalledOnce();
    expect(reconciliationTx.document.create).toHaveBeenCalledOnce();
    expect(reconciliationTx.workflowExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalExecutionId: 'exec_123',
        status: WorkflowStatus.RUNNING,
        metadata: {
          workflowId: 'workflow_123',
          reconciliationRequired: true,
          localPersistenceError: 'audit write failed',
        },
      }),
    });
    expect(existsSync(uploadTestDirectory)).toBe(true);
    expect(readdirSync(uploadTestDirectory)).toHaveLength(1);
  });
  it('records an audit event when upload reconciliation is required after ingestion starts', async () => {
    const acceptedStatusError = new Error('audit write failed');
    const reconciliationTx = {
      upload: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      document: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      workflowExecution: {
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      $transaction: vi
        .fn()
        .mockRejectedValueOnce(acceptedStatusError)
        .mockImplementationOnce(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
          callback(reconciliationTx),
        ),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockResolvedValue({
          executionId: 'exec_123',
          workflowId: 'workflow_123',
          status: 'running',
        }),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });

    await expect(
      service.createUpload({
        userId: 'user_1',
        fileName: 'Quarterly Report.PDF',
        mimeType: 'application/pdf',
        bytes: Buffer.from('hello world'),
        requestId: 'req_upload',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
      }),
    ).resolves.toMatchObject({
      uploadId: expect.any(String),
      workflowExecutionId: expect.any(String),
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
      reconciliationRequired: true,
    });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'upload.ingestion_reconciliation_required',
        entityType: 'upload',
        entityId: expect.any(String),
        requestId: 'req_upload',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        metadata: {
          documentId: expect.any(String),
          workflowExecutionId: expect.any(String),
          externalExecutionId: 'exec_123',
          error: 'audit write failed',
        },
      },
    });
  });
  it('uses unique temp storage paths for same-name uploads', async () => {
    const acceptedTx = {
      upload: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      document: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      workflowExecution: {
        create: vi
          .fn()
          .mockResolvedValueOnce({
            id: 'workflow_1',
            status: WorkflowStatus.RUNNING,
            externalExecutionId: 'exec_1',
          })
          .mockResolvedValueOnce({
            id: 'workflow_2',
            status: WorkflowStatus.RUNNING,
            externalExecutionId: 'exec_2',
          }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof acceptedTx) => Promise<unknown>) => callback(acceptedTx))
        .mockImplementationOnce(async (callback: (transaction: typeof acceptedTx) => Promise<unknown>) => callback(acceptedTx)),
      upload: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      workflowExecution: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const service = new UploadService({
      db: db as never,
      validationService: {
        validate: vi.fn().mockResolvedValue({
          normalizedExtension: 'pdf',
          normalizedMimeType: 'application/pdf',
        }),
      } as never,
      virusScanService: {
        scanFile: vi.fn().mockResolvedValue({ clean: true, scanner: 'local-noop' }),
      } as never,
      ingestionService: {
        startDocumentIngestion: vi
          .fn()
          .mockResolvedValueOnce({ executionId: 'exec_1', workflowId: 'wf_1', status: 'running' })
          .mockResolvedValueOnce({ executionId: 'exec_2', workflowId: 'wf_2', status: 'running' }),
      } as never,
      uploadConfig: {
        maxBytes: 10_000_000,
        tempDirectory: uploadTestDirectory,
      },
    });
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_725_000_000_000);

    const first = await service.createUpload({
      userId: 'user_1',
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      bytes: Buffer.from('first upload'),
    });
    const second = await service.createUpload({
      userId: 'user_1',
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      bytes: Buffer.from('second upload'),
    });

    dateNowSpy.mockRestore();

    expect(first.storagePath).not.toBe(second.storagePath);
    expect(existsSync(first.storagePath)).toBe(true);
    expect(existsSync(second.storagePath)).toBe(true);
  });
  it('lists and soft deletes only documents owned by the current user', async () => {
    const deleteTx = {
      document: {
        update: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.DELETED,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          fileHash: 'hash_1',
          storagePath: '/uploads/quarterly-report.pdf',
          metadata: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
          deletedAt: new Date('2026-01-03T00:00:00.000Z'),
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      document: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'document_1',
            userId: 'user_1',
            uploadId: 'upload_1',
            status: DocumentStatus.READY,
            title: 'Quarterly Report',
            originalFilename: 'quarterly-report.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1024,
            fileHash: 'hash_1',
            storagePath: '/uploads/quarterly-report.pdf',
            metadata: null,
            _count: {
              chunks: 0,
            },
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            deletedAt: null,
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 1024,
          fileHash: 'hash_1',
          storagePath: '/uploads/quarterly-report.pdf',
          metadata: null,
          _count: {
            chunks: 0,
          },
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (transaction: typeof deleteTx) => Promise<unknown>) => callback(deleteTx)),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn(),
    };

    const service = new DocumentService({
      db: db as never,
      ingestionService: ingestionService as never,
    });

    const listResult = await service.listDocuments('user_1', {
      search: 'Quarterly',
      status: 'READY',
      sort: 'updatedAt',
      order: 'desc',
      page: 1,
      pageSize: 10,
    });

    expect(listResult.total).toBe(1);
    expect(listResult.items[0]).toMatchObject({
      id: 'document_1',
      title: 'Quarterly Report',
      status: 'READY',
    });

    const deleted = await service.softDeleteDocument('user_1', 'document_1', {
      requestId: 'req_delete',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(db.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user_1',
          deletedAt: null,
          status: DocumentStatus.READY,
        }),
      }),
    );
    expect(deleted.status).toBe('DELETED');
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(deleteTx.document.update).toHaveBeenCalledWith({
      where: { id: 'document_1' },
      data: {
        status: DocumentStatus.DELETED,
        deletedAt: expect.any(Date),
      },
    });
    expect(deleteTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'document.deleted',
        entityType: 'document',
        entityId: 'document_1',
        requestId: 'req_delete',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        metadata: expect.objectContaining({
          title: 'Quarterly Report',
        }),
      },
    });
    expect(db.document.update).not.toHaveBeenCalled();
  });

  it('records reindex audit logging in the same transaction as workflow creation without downgrading the document', async () => {
    const queueTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn().mockResolvedValue({
          id: 'document_1',
          status: DocumentStatus.INGESTING,
        }),
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const tx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn().mockResolvedValue({
          id: 'document_1',
          status: DocumentStatus.INGESTING,
        }),
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof queueTx) => Promise<unknown>) => callback(queueTx))
        .mockImplementationOnce(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn().mockResolvedValue({
        executionId: 'exec_123',
        workflowId: 'workflow_123',
        status: 'running',
      }),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: ingestionService as never,
    });

    const result = await service.requestReindex('user_1', 'document_1', 'req_reindex');

    expect(result).toEqual({
      workflowExecutionId: 'workflow_1',
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
    });
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(queueTx.workflowExecution.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        userId: 'user_1',
        documentId: 'document_1',
        uploadId: 'upload_1',
        workflowKey: 'ingestion',
        status: WorkflowStatus.QUEUED,
        metadata: {
          operation: 'reindex',
          previousDocumentStatus: DocumentStatus.READY,
        },
      },
    });
    expect(tx.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: {
        externalExecutionId: 'exec_123',
        status: WorkflowStatus.RUNNING,
        metadata: {
          operation: 'reindex',
          previousDocumentStatus: DocumentStatus.READY,
          workflowId: 'workflow_123',
        },
      },
    });
    expect(tx.document.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'document.reindex_requested',
        entityType: 'document',
        entityId: 'document_1',
        requestId: 'req_reindex',
        metadata: {
          workflowExecutionId: expect.any(String),
          externalExecutionId: 'exec_123',
          uploadId: 'upload_1',
        },
      },
    });
  });
  it('rejects a reindex request when the document already has an active ingestion workflow', async () => {
    const tx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_active',
          status: WorkflowStatus.WAITING,
          externalExecutionId: 'exec_active',
        }),
        create: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn(),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: ingestionService as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'ACTIVE_WORKFLOW',
        documentId: 'document_1',
        workflowExecutionId: 'workflow_active',
        workflowStatus: WorkflowStatus.WAITING,
      },
    });

    expect(ingestionService.startDocumentIngestion).not.toHaveBeenCalled();
    expect(tx.workflowExecution.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
  it('does not leave unrecoverable initial-state reindex rows when start-failure audit persistence fails', async () => {
    const queueTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const tx = {
      workflowExecution: {
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error('audit write failed')),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.ERROR,
          externalExecutionId: null,
        }),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof queueTx) => Promise<unknown>) => callback(queueTx))
        .mockImplementationOnce(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      } as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex')).rejects.toThrow('audit write failed');

    expect(queueTx.workflowExecution.create).toHaveBeenCalledOnce();
    expect(tx.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: {
        status: WorkflowStatus.ERROR,
        errorMessage: 'n8n unavailable',
      },
    });
    expect(db.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: {
        status: WorkflowStatus.ERROR,
        errorMessage: 'n8n unavailable',
      },
    });
  });
  it('preserves accepted reindex executions when post-start persistence fails', async () => {
    const persistenceError = new Error('audit write failed');
    const queueTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const tx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(persistenceError),
      },
    };
    const reconciliationTx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof queueTx) => Promise<unknown>) => callback(queueTx))
        .mockImplementationOnce(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
        .mockImplementationOnce(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
          callback(reconciliationTx),
        ),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn().mockResolvedValue({
        executionId: 'exec_123',
        workflowId: 'workflow_123',
        status: 'running',
      }),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: ingestionService as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });

    expect(db.$transaction).toHaveBeenCalledTimes(3);
    expect(reconciliationTx.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: {
        externalExecutionId: 'exec_123',
        status: WorkflowStatus.RUNNING,
        metadata: {
          operation: 'reindex',
          previousDocumentStatus: DocumentStatus.READY,
          workflowId: 'workflow_123',
          reconciliationRequired: true,
          localPersistenceError: 'audit write failed',
        },
      },
    });
    expect(db.document.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DocumentStatus.FAILED }),
      }),
    );
  });
  it('records an audit event when reindex ingestion fails to start after queueing the local workflow row', async () => {
    const queueTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const tx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.ERROR,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof queueTx) => Promise<unknown>) => callback(queueTx))
        .mockImplementationOnce(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      } as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex')).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'document.reindex_start_failed',
        entityType: 'document',
        entityId: 'document_1',
        requestId: 'req_reindex',
        metadata: {
          workflowExecutionId: expect.any(String),
          uploadId: 'upload_1',
          error: 'n8n unavailable',
        },
      },
    });
  });
  it('records an audit event when reindex reconciliation is required after ingestion starts', async () => {
    const persistenceError = new Error('audit write failed');
    const queueTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const tx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(persistenceError),
      },
    };
    const reconciliationTx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof queueTx) => Promise<unknown>) => callback(queueTx))
        .mockImplementationOnce(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
        .mockImplementationOnce(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
          callback(reconciliationTx),
        ),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockResolvedValue({
          executionId: 'exec_123',
          workflowId: 'workflow_123',
          status: 'running',
        }),
      } as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });

    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'document.reindex_reconciliation_required',
        entityType: 'document',
        entityId: 'document_1',
        requestId: 'req_reindex',
        metadata: {
          workflowExecutionId: expect.any(String),
          externalExecutionId: 'exec_123',
          uploadId: 'upload_1',
          error: 'audit write failed',
        },
      },
    });
  });
  it('preserves reindex reconciliation state when the follow-up audit write fails', async () => {
    const persistenceError = new Error('audit write failed');
    const queueTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
          externalExecutionId: null,
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const tx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(persistenceError),
      },
    };
    const reconciliationTx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(new Error('audit insert failed')),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof queueTx) => Promise<unknown>) => callback(queueTx))
        .mockImplementationOnce(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx))
        .mockImplementationOnce(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
          callback(reconciliationTx),
        ),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: {
        startDocumentIngestion: vi.fn().mockResolvedValue({
          executionId: 'exec_123',
          workflowId: 'workflow_123',
          status: 'running',
        }),
      } as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });

    expect(reconciliationTx.workflowExecution.update).toHaveBeenCalledOnce();
    expect(db.auditLog.create).toHaveBeenCalledOnce();
  });
  it('blocks an immediate second reindex after accepted start when post-start persistence fails', async () => {
    const persistenceError = new Error('audit write failed');
    const sharedWorkflow = {
      id: 'workflow_queued',
      userId: 'user_1',
      documentId: 'document_1',
      uploadId: 'upload_1',
      workflowKey: 'ingestion',
      status: WorkflowStatus.QUEUED,
      externalExecutionId: null as string | null,
      metadata: {
        operation: 'reindex',
        previousDocumentStatus: DocumentStatus.READY,
      },
    };
    const initialTx = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(async ({ data }: { data: typeof sharedWorkflow }) => {
          Object.assign(sharedWorkflow, {
            ...data,
            externalExecutionId: data.externalExecutionId ?? null,
          });
          return { ...sharedWorkflow };
        }),
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const failedPostStartTx = {
      workflowExecution: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({
          ...sharedWorkflow,
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
          metadata: {
            ...sharedWorkflow.metadata,
            workflowId: 'workflow_123',
          },
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockRejectedValue(persistenceError),
      },
    };
    const reconciliationTx = {
      workflowExecution: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn().mockImplementation(async ({ data }: { data: { status: WorkflowStatus; externalExecutionId: string; metadata: typeof sharedWorkflow.metadata & { workflowId: string; reconciliationRequired: true; localPersistenceError: string } } }) => {
          Object.assign(sharedWorkflow, {
            status: data.status,
            externalExecutionId: data.externalExecutionId,
            metadata: data.metadata,
          });
          return { ...sharedWorkflow };
        }),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const conflictTx = {
      workflowExecution: {
        findFirst: vi.fn().mockImplementation(async () => ({
          id: sharedWorkflow.id,
          status: sharedWorkflow.status,
          externalExecutionId: sharedWorkflow.externalExecutionId,
        })),
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          status: DocumentStatus.READY,
          title: 'Quarterly Report',
          originalFilename: 'quarterly-report.pdf',
          mimeType: 'application/pdf',
          storagePath: '/uploads/quarterly-report.pdf',
          deletedAt: null,
        }),
        update: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      $transaction: vi
        .fn()
        .mockImplementationOnce(async (callback: (transaction: typeof initialTx) => Promise<unknown>) => callback(initialTx))
        .mockImplementationOnce(async (callback: (transaction: typeof failedPostStartTx) => Promise<unknown>) =>
          callback(failedPostStartTx),
        )
        .mockImplementationOnce(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
          callback(reconciliationTx),
        )
        .mockImplementationOnce(async (callback: (transaction: typeof conflictTx) => Promise<unknown>) => callback(conflictTx)),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn().mockResolvedValue({
        executionId: 'exec_123',
        workflowId: 'workflow_123',
        status: 'running',
      }),
    };
    const service = new DocumentService({
      db: db as never,
      ingestionService: ingestionService as never,
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex_1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });

    await expect(service.requestReindex('user_1', 'document_1', 'req_reindex_2')).rejects.toMatchObject({
      code: 'CONFLICT',
      details: {
        reason: 'ACTIVE_WORKFLOW',
        workflowExecutionId: sharedWorkflow.id,
        workflowStatus: WorkflowStatus.RUNNING,
      },
    });

    expect(initialTx.workflowExecution.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        userId: 'user_1',
        documentId: 'document_1',
        uploadId: 'upload_1',
        workflowKey: 'ingestion',
        status: WorkflowStatus.QUEUED,
        metadata: {
          operation: 'reindex',
          previousDocumentStatus: DocumentStatus.READY,
        },
      },
    });
    expect(reconciliationTx.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: expect.any(String) },
      data: {
        externalExecutionId: 'exec_123',
        status: WorkflowStatus.RUNNING,
        metadata: {
          operation: 'reindex',
          previousDocumentStatus: DocumentStatus.READY,
          workflowId: 'workflow_123',
          reconciliationRequired: true,
          localPersistenceError: 'audit write failed',
        },
      },
    });
    expect(ingestionService.startDocumentIngestion).toHaveBeenCalledTimes(1);
  });
  it('reconciles resource statuses for accepted workflows that already completed remotely', async () => {
    const reconciliationTx = {
      upload: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
        callback(reconciliationTx),
      ),
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: { ok: true },
          metadata: {
            reconciliationRequired: true,
          },
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn(),
      },
    };
    const executionService = {
      pollExecution: vi.fn(),
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: executionService as never,
    });

    const result = await service.getWorkflowStatus('user_1', 'workflow_1');

    expect(executionService.pollExecution).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'workflow_1',
      status: 'SUCCESS',
      externalExecutionId: 'exec_123',
    });
    expect(reconciliationTx.upload.updateMany).toHaveBeenCalledWith({
      where: { id: 'upload_1', userId: 'user_1', status: { not: UploadStatus.COMPLETED } },
      data: { status: UploadStatus.COMPLETED },
    });
    expect(reconciliationTx.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'document_1', userId: 'user_1', status: { notIn: [DocumentStatus.READY, DocumentStatus.DELETED] } },
      data: { status: DocumentStatus.READY },
    });
    expect(reconciliationTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'workflow.reconciled',
        entityType: 'workflow_execution',
        entityId: 'workflow_1',
        metadata: {
          workflowKey: 'ingestion',
          workflowStatus: WorkflowStatus.SUCCESS,
          uploadId: 'upload_1',
          uploadStatus: UploadStatus.COMPLETED,
          uploadUpdated: true,
          documentId: 'document_1',
          documentStatus: DocumentStatus.READY,
          documentUpdated: true,
          reconciliationRequired: true,
        },
      },
    });
  });

  it('does not resurrect deleted documents during workflow reconciliation', async () => {
    const reconciliationTx = {
      upload: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation(async (callback: (transaction: typeof reconciliationTx) => Promise<unknown>) =>
        callback(reconciliationTx),
      ),
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: { ok: true },
          metadata: {
            reconciliationRequired: true,
          },
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn(),
      },
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: {
        pollExecution: vi.fn(),
      } as never,
    });

    await service.getWorkflowStatus('user_1', 'workflow_1');

    expect(reconciliationTx.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'document_1', userId: 'user_1', status: { notIn: [DocumentStatus.READY, DocumentStatus.DELETED] } },
      data: { status: DocumentStatus.READY },
    });
    expect(reconciliationTx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'workflow.reconciled',
        entityType: 'workflow_execution',
        entityId: 'workflow_1',
        metadata: expect.objectContaining({
          documentId: 'document_1',
          documentStatus: DocumentStatus.READY,
          documentUpdated: false,
        }),
      },
    });
  });

  it('does not downgrade existing resources when a reindex workflow fails', async () => {
    const db = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.ERROR,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: { ok: false },
          metadata: {
            operation: 'reindex',
            previousDocumentStatus: DocumentStatus.READY,
            reconciliationRequired: true,
          },
          errorMessage: 'workflow failed',
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn(),
      },
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: {
        pollExecution: vi.fn(),
      } as never,
    });

    const result = await service.getWorkflowStatus('user_1', 'workflow_1');

    expect(result).toMatchObject({
      id: 'workflow_1',
      status: 'ERROR',
      errorMessage: 'workflow failed',
    });
    expect(db.upload.updateMany).not.toHaveBeenCalled();
    expect(db.document.updateMany).not.toHaveBeenCalled();
  });

  it('marks the document ready after a successful reindex without mutating the original upload', async () => {
    const db = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: { ok: true },
          metadata: {
            operation: 'reindex',
            previousDocumentStatus: DocumentStatus.FAILED,
            reconciliationRequired: true,
          },
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: {
        pollExecution: vi.fn(),
      } as never,
    });

    const result = await service.getWorkflowStatus('user_1', 'workflow_1');

    expect(result).toMatchObject({
      id: 'workflow_1',
      status: 'SUCCESS',
      externalExecutionId: 'exec_123',
    });
    expect(db.upload.updateMany).not.toHaveBeenCalled();
    expect(db.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'document_1', userId: 'user_1', status: { notIn: [DocumentStatus.READY, DocumentStatus.DELETED] } },
      data: { status: DocumentStatus.READY },
    });
  });

  it('polls running workflows and persists normalized completion status', async () => {
    const db = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: null,
          metadata: null,
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        findMany: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: { ok: true },
          metadata: null,
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
      },
      upload: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const executionService = {
      pollExecution: vi.fn().mockResolvedValue({
        id: 'exec_123',
        workflowId: 'workflow_123',
        status: 'success',
        rawStatus: 'success',
        finished: true,
        mode: 'manual',
        startedAt: '2026-01-01T00:00:00.000Z',
        stoppedAt: '2026-01-01T00:01:00.000Z',
        waitTill: null,
        retryOf: null,
        data: { ok: true },
      }),
    };

    const service = new WorkflowService({
      db: db as never,
      executionService: executionService as never,
    });

    const result = await service.getWorkflowStatus('user_1', 'workflow_1');

    expect(executionService.pollExecution).toHaveBeenCalledWith('exec_123');
    expect(result).toMatchObject({
      id: 'workflow_1',
      status: 'SUCCESS',
      externalExecutionId: 'exec_123',
    });
    expect(db.upload.updateMany).toHaveBeenCalledWith({
      where: { id: 'upload_1', userId: 'user_1', status: { not: UploadStatus.COMPLETED } },
      data: { status: UploadStatus.COMPLETED },
    });
    expect(db.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'document_1', userId: 'user_1', status: { notIn: [DocumentStatus.READY, DocumentStatus.DELETED] } },
      data: { status: DocumentStatus.READY },
    });
  });

  it('returns the last persisted workflow state when polling status fails', async () => {
    const reconciliationIssueTx = {
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: null,
          metadata: {
            reconciliationRequired: true,
            reconciliationHealth: 'degraded',
            reconciliationIssue: 'UPSTREAM_UNAVAILABLE',
            reconciliationSource: 'n8n_poll',
            lastReconciliationAttemptAt: '2026-01-01T00:02:00.000Z',
            lastReconciliationFailureAt: '2026-01-01T00:02:00.000Z',
          },
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:02:00.000Z'),
        }),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      $transaction: vi.fn().mockImplementation(async (callback: (transaction: typeof reconciliationIssueTx) => Promise<unknown>) =>
        callback(reconciliationIssueTx),
      ),
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
          requestPayload: null,
          responsePayload: null,
          metadata: null,
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        update: vi.fn(),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn(),
      },
    };
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));

    try {
      const executionService = {
        pollExecution: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      };
      const service = new WorkflowService({
        db: db as never,
        executionService: executionService as never,
      });

      const result = await service.getWorkflowStatus('user_1', 'workflow_1');

      expect(executionService.pollExecution).toHaveBeenCalledWith('exec_123');
      expect(reconciliationIssueTx.workflowExecution.update).toHaveBeenCalledWith({
        where: { id: 'workflow_1' },
        data: {
          metadata: {
            reconciliationRequired: true,
            reconciliationHealth: 'degraded',
            reconciliationIssue: 'UPSTREAM_UNAVAILABLE',
            reconciliationSource: 'n8n_poll',
            lastReconciliationAttemptAt: '2026-01-01T00:02:00.000Z',
            lastReconciliationFailureAt: '2026-01-01T00:02:00.000Z',
          },
        },
      });
      expect(reconciliationIssueTx.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user_1',
          action: 'workflow.reconciliation_issue_recorded',
          entityType: 'workflow_execution',
          entityId: 'workflow_1',
          metadata: {
            workflowKey: 'ingestion',
            workflowStatus: WorkflowStatus.RUNNING,
            reconciliationIssue: 'UPSTREAM_UNAVAILABLE',
            reconciliationSource: 'n8n_poll',
            reconciliationRequired: true,
            uploadId: 'upload_1',
            documentId: 'document_1',
          },
        },
      });
      expect(result).toMatchObject({
        id: 'workflow_1',
        status: 'RUNNING',
        externalExecutionId: 'exec_123',
        errorMessage: null,
        metadata: {
          reconciliationRequired: true,
          reconciliationHealth: 'degraded',
          reconciliationIssue: 'UPSTREAM_UNAVAILABLE',
          reconciliationSource: 'n8n_poll',
        },
      });
      expect(db.upload.updateMany).not.toHaveBeenCalled();
      expect(db.document.updateMany).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles active workflows before returning the public workflow list', async () => {
    const db = {
      workflowExecution: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'workflow_1',
            userId: 'user_1',
            uploadId: 'upload_1',
            documentId: 'document_1',
            workflowKey: 'ingestion',
            status: WorkflowStatus.RUNNING,
            externalExecutionId: 'exec_123',
            requestPayload: { prompt: 'secret' },
            responsePayload: null,
            metadata: null,
            errorMessage: null,
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
          requestPayload: { prompt: 'secret' },
          responsePayload: null,
          metadata: null,
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: { prompt: 'secret' },
          responsePayload: { ok: true },
          metadata: null,
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
      },
      upload: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const executionService = {
      pollExecution: vi.fn().mockResolvedValue({
        id: 'exec_123',
        workflowId: 'workflow_123',
        status: 'success',
        rawStatus: 'success',
        finished: true,
        mode: 'manual',
        startedAt: '2026-01-01T00:00:00.000Z',
        stoppedAt: '2026-01-01T00:01:00.000Z',
        waitTill: null,
        retryOf: null,
        data: { ok: true },
      }),
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: executionService as never,
    });

    const result = await service.listPublicWorkflows('user_1');

    expect(executionService.pollExecution).toHaveBeenCalledWith('exec_123');
    expect(db.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'workflow_1' },
      data: {
        status: WorkflowStatus.SUCCESS,
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:01:00.000Z'),
        errorMessage: null,
        responsePayload: { ok: true },
      },
    });
    expect(result).toEqual({
      items: [
        {
          id: 'workflow_1',
          workflowKey: 'ingestion',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:01:00.000Z',
          uploadId: 'upload_1',
          documentId: 'document_1',
          reconciliationRequired: false,
        },
      ],
      total: 1,
    });
  });

  it('limits public workflows to the latest requested document executions', async () => {
    const db = {
      workflowExecution: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'workflow_3',
            userId: 'user_1',
            uploadId: 'upload_3',
            documentId: 'document_2',
            workflowKey: 'ingestion',
            status: WorkflowStatus.SUCCESS,
            externalExecutionId: null,
            requestPayload: { prompt: 'secret' },
            responsePayload: { ok: true },
            metadata: null,
            errorMessage: null,
            startedAt: new Date('2026-01-03T00:00:00.000Z'),
            completedAt: new Date('2026-01-03T00:01:00.000Z'),
            createdAt: new Date('2026-01-03T00:00:00.000Z'),
            updatedAt: new Date('2026-01-03T00:01:00.000Z'),
          },
          {
            id: 'workflow_2',
            userId: 'user_1',
            uploadId: 'upload_1',
            documentId: 'document_1',
            workflowKey: 'ingestion',
            status: WorkflowStatus.RUNNING,
            externalExecutionId: null,
            requestPayload: { prompt: 'secret' },
            responsePayload: null,
            metadata: null,
            errorMessage: null,
            startedAt: new Date('2026-01-02T00:00:00.000Z'),
            completedAt: null,
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:01:00.000Z'),
          },
          {
            id: 'workflow_1',
            userId: 'user_1',
            uploadId: 'upload_1',
            documentId: 'document_1',
            workflowKey: 'ingestion',
            status: WorkflowStatus.ERROR,
            externalExecutionId: null,
            requestPayload: { prompt: 'secret' },
            responsePayload: null,
            metadata: null,
            errorMessage: 'Older workflow should be excluded.',
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:01:00.000Z'),
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:01:00.000Z'),
          },
        ]),
      },
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: {
        pollExecution: vi.fn(),
      } as never,
    });

    const result = await service.listPublicWorkflows('user_1', {
      documentIds: ['document_1', 'document_2'],
      pageSize: 1,
    });

    expect(db.workflowExecution.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user_1',
        documentId: { in: ['document_1', 'document_2'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(result).toEqual({
      items: [
        {
          id: 'workflow_3',
          workflowKey: 'ingestion',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:01:00.000Z',
          startedAt: '2026-01-03T00:00:00.000Z',
          completedAt: '2026-01-03T00:01:00.000Z',
          uploadId: 'upload_3',
          documentId: 'document_2',
          reconciliationRequired: false,
        },
      ],
      total: 2,
    });
  });

  it('keeps listing workflows when one active workflow cannot be polled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));

    try {
      const db = {
        workflowExecution: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'workflow_1',
              userId: 'user_1',
              uploadId: 'upload_1',
              documentId: 'document_1',
              workflowKey: 'ingestion',
              status: WorkflowStatus.RUNNING,
              externalExecutionId: 'exec_123',
              requestPayload: { prompt: 'secret' },
              responsePayload: null,
              metadata: null,
              errorMessage: null,
              startedAt: new Date('2026-01-01T00:00:00.000Z'),
              completedAt: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
              id: 'workflow_2',
              userId: 'user_1',
              uploadId: 'upload_2',
              documentId: 'document_2',
              workflowKey: 'ingestion',
              status: WorkflowStatus.SUCCESS,
              externalExecutionId: 'exec_456',
              requestPayload: { prompt: 'secret-2' },
              responsePayload: { ok: true },
              metadata: null,
              errorMessage: null,
              startedAt: new Date('2026-01-01T00:03:00.000Z'),
              completedAt: new Date('2026-01-01T00:04:00.000Z'),
              createdAt: new Date('2026-01-01T00:03:00.000Z'),
              updatedAt: new Date('2026-01-01T00:04:00.000Z'),
            },
          ]),
          count: vi.fn().mockResolvedValue(2),
          update: vi.fn().mockResolvedValue({
            id: 'workflow_1',
            userId: 'user_1',
            uploadId: 'upload_1',
            documentId: 'document_1',
            workflowKey: 'ingestion',
            status: WorkflowStatus.RUNNING,
            externalExecutionId: 'exec_123',
            requestPayload: { prompt: 'secret' },
            responsePayload: null,
            metadata: {
              reconciliationRequired: true,
              reconciliationHealth: 'degraded',
              reconciliationIssue: 'UPSTREAM_UNAVAILABLE',
              reconciliationSource: 'n8n_poll',
              lastReconciliationAttemptAt: '2026-01-01T00:02:00.000Z',
              lastReconciliationFailureAt: '2026-01-01T00:02:00.000Z',
            },
            errorMessage: null,
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:02:00.000Z'),
          }),
        },
        upload: {
          updateMany: vi.fn(),
        },
        document: {
          updateMany: vi.fn(),
        },
      };
      const executionService = {
        pollExecution: vi.fn().mockRejectedValue(new Error('n8n unavailable')),
      };
      const service = new WorkflowService({
        db: db as never,
        executionService: executionService as never,
      });

      const result = await service.listPublicWorkflows('user_1');

      expect(result).toEqual({
        items: [
          {
            id: 'workflow_1',
            workflowKey: 'ingestion',
            status: 'RUNNING',
            errorMessage: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:02:00.000Z',
            startedAt: '2026-01-01T00:00:00.000Z',
            completedAt: null,
            uploadId: 'upload_1',
            documentId: 'document_1',
            reconciliationRequired: true,
          },
          {
            id: 'workflow_2',
            workflowKey: 'ingestion',
            status: 'SUCCESS',
            errorMessage: null,
            createdAt: '2026-01-01T00:03:00.000Z',
            updatedAt: '2026-01-01T00:04:00.000Z',
            startedAt: '2026-01-01T00:03:00.000Z',
            completedAt: '2026-01-01T00:04:00.000Z',
            uploadId: 'upload_2',
            documentId: 'document_2',
            reconciliationRequired: false,
          },
        ],
        total: 2,
      });
      expect(executionService.pollExecution).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let older workflow executions overwrite newer resource state during list reconciliation', async () => {
    const olderWorkflow = {
      id: 'workflow_old',
      userId: 'user_1',
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowKey: 'ingestion',
      status: WorkflowStatus.SUCCESS,
      externalExecutionId: 'exec_old',
      requestPayload: null,
      responsePayload: { ok: true },
      metadata: { reconciliationRequired: true },
      errorMessage: null,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T00:01:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    };
    const newerWorkflow = {
      id: 'workflow_new',
      userId: 'user_1',
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowKey: 'ingestion',
      status: WorkflowStatus.RUNNING,
      externalExecutionId: 'exec_new',
      requestPayload: null,
      responsePayload: null,
      metadata: null,
      errorMessage: null,
      startedAt: new Date('2026-01-02T00:00:00.000Z'),
      completedAt: null,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    };
    const db = {
      workflowExecution: {
        findMany: vi.fn().mockResolvedValue([newerWorkflow, olderWorkflow]),
        count: vi.fn().mockResolvedValue(2),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(newerWorkflow)
          .mockResolvedValueOnce(newerWorkflow),
        update: vi.fn().mockResolvedValue(newerWorkflow),
      },
      upload: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const executionService = {
      pollExecution: vi.fn().mockResolvedValue({
        id: 'exec_new',
        workflowId: 'workflow_123',
        status: 'running',
        rawStatus: 'running',
        finished: false,
        mode: 'manual',
        startedAt: '2026-01-02T00:00:00.000Z',
        stoppedAt: null,
        waitTill: null,
        retryOf: null,
        data: null,
      }),
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: executionService as never,
    });

    await service.listPublicWorkflows('user_1');

    expect(db.workflowExecution.findFirst).toHaveBeenCalledTimes(1);
    expect(db.upload.updateMany).not.toHaveBeenCalled();
    expect(db.document.updateMany).not.toHaveBeenCalled();
  });


  it('skips workflow writes and audit logs for unchanged running polls', async () => {
    const runningWorkflow = {
      id: 'workflow_1',
      userId: 'user_1',
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowKey: 'ingestion',
      status: WorkflowStatus.RUNNING,
      externalExecutionId: 'exec_123',
      requestPayload: null,
      responsePayload: { step: 'ingesting' },
      metadata: { workflowId: 'workflow_123' },
      errorMessage: null,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const db = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue(runningWorkflow),
        update: vi.fn(),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(db)),
    };
    const executionService = {
      pollExecution: vi.fn().mockResolvedValue({
        id: 'exec_123',
        workflowId: 'workflow_123',
        status: 'running',
        rawStatus: 'running',
        finished: false,
        mode: 'manual',
        startedAt: '2026-01-01T00:00:00.000Z',
        stoppedAt: null,
        waitTill: null,
        retryOf: null,
        data: { step: 'ingesting' },
      }),
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: executionService as never,
    });

    const first = await service.getWorkflowStatus('user_1', 'workflow_1');
    const second = await service.getWorkflowStatus('user_1', 'workflow_1');

    expect(first).toMatchObject({
      id: 'workflow_1',
      status: 'RUNNING',
      externalExecutionId: 'exec_123',
      responsePayload: { step: 'ingesting' },
    });
    expect(second).toMatchObject({
      id: 'workflow_1',
      status: 'RUNNING',
      externalExecutionId: 'exec_123',
      responsePayload: { step: 'ingesting' },
    });
    expect(executionService.pollExecution).toHaveBeenCalledTimes(2);
    expect(db.workflowExecution.update).not.toHaveBeenCalled();
    expect(db.upload.updateMany).not.toHaveBeenCalled();
    expect(db.document.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it('maps workflow responses to a sanitized public DTO', async () => {
    const db = {
      workflowExecution: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'workflow_1',
            userId: 'user_1',
            uploadId: 'upload_1',
            documentId: 'document_1',
            workflowKey: 'ingestion',
            status: WorkflowStatus.SUCCESS,
            externalExecutionId: 'exec_123',
            requestPayload: { prompt: 'secret' },
            responsePayload: { ok: true },
            metadata: {
              workflowId: 'workflow_123',
              reconciliationRequired: true,
            },
            errorMessage: null,
            startedAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-01T00:01:00.000Z'),
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:01:00.000Z'),
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: { prompt: 'secret' },
          responsePayload: { ok: true },
          metadata: {
            workflowId: 'workflow_123',
            reconciliationRequired: true,
          },
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
      },
      upload: {
        updateMany: vi.fn(),
      },
      document: {
        updateMany: vi.fn(),
      },
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: {
        pollExecution: vi.fn(),
      } as never,
    });

    const result = await service.listPublicWorkflows('user_1');

    expect(result).toEqual({
      items: [
        {
          id: 'workflow_1',
          workflowKey: 'ingestion',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:01:00.000Z',
          startedAt: '2026-01-01T00:00:00.000Z',
          completedAt: '2026-01-01T00:01:00.000Z',
          uploadId: 'upload_1',
          documentId: 'document_1',
          reconciliationRequired: true,
        },
      ],
      total: 1,
    });
  });

  it('omits raw workflow payloads and external execution ids from public status responses', async () => {
    const db = {
      workflowExecution: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          userId: 'user_1',
          uploadId: 'upload_1',
          documentId: 'document_1',
          workflowKey: 'ingestion',
          status: WorkflowStatus.SUCCESS,
          externalExecutionId: 'exec_123',
          requestPayload: { prompt: 'secret' },
          responsePayload: { ok: true },
          metadata: {
            workflowId: 'workflow_123',
            reconciliationRequired: true,
          },
          errorMessage: null,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          completedAt: new Date('2026-01-01T00:01:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:01:00.000Z'),
        }),
      },
      upload: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      document: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new WorkflowService({
      db: db as never,
      executionService: {
        pollExecution: vi.fn(),
      } as never,
    });

    const result = await service.getPublicWorkflowStatus('user_1', 'workflow_1');

    expect(result).toEqual({
      id: 'workflow_1',
      workflowKey: 'ingestion',
      status: 'SUCCESS',
      errorMessage: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      uploadId: 'upload_1',
      documentId: 'document_1',
      reconciliationRequired: true,
    });
  });
});
