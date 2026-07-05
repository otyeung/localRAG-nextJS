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
    const tx = {
      upload: {
        create: vi.fn().mockResolvedValue({ id: 'upload_1' }),
      },
      document: {
        create: vi.fn().mockResolvedValue({ id: 'document_1' }),
      },
      workflowExecution: {
        create: vi.fn().mockResolvedValue({ id: 'workflow_1' }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      upload: {
        update: vi.fn().mockResolvedValue({ id: 'upload_1', status: UploadStatus.INGESTING }),
      },
      document: {
        update: vi.fn().mockResolvedValue({ id: 'document_1', status: DocumentStatus.INGESTING }),
      },
      workflowExecution: {
        update: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.RUNNING,
          externalExecutionId: 'exec_123',
        }),
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
    const auditService = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    const service = new UploadService({
      db: db as never,
      validationService: validationService as never,
      virusScanService: virusScanService as never,
      ingestionService: ingestionService as never,
      auditService: auditService as never,
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

    expect(result).toMatchObject({
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowExecutionId: 'workflow_1',
      externalExecutionId: 'exec_123',
      status: 'RUNNING',
    });
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.upload.create).toHaveBeenCalledOnce();
    expect(tx.document.create).toHaveBeenCalledOnce();
    expect(tx.workflowExecution.create).toHaveBeenCalledOnce();
    expect(validationService.validate).toHaveBeenCalledWith({
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      size: 11,
    });
    expect(virusScanService.scanFile).toHaveBeenCalledWith(expect.stringContaining(uploadTestDirectory));
    expect(ingestionService.startDocumentIngestion).toHaveBeenCalledWith({
      documentId: 'document_1',
      uploadId: 'upload_1',
      filePath: expect.stringContaining(uploadTestDirectory),
      fileName: 'Quarterly Report.PDF',
      mimeType: 'application/pdf',
      requestId: 'req_upload',
    });
    expect(auditService.record).toHaveBeenCalledWith({
      userId: 'user_1',
      action: 'upload.created',
      entityType: 'upload',
      entityId: 'upload_1',
      requestId: 'req_upload',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      metadata: expect.objectContaining({
        documentId: 'document_1',
        workflowExecutionId: 'workflow_1',
      }),
    });
    expect(existsSync(result.storagePath)).toBe(true);
  });

  it('removes persisted temp files when ingestion fails after transactional record creation', async () => {
    const tx = {
      upload: {
        create: vi.fn().mockResolvedValue({ id: 'upload_1' }),
      },
      document: {
        create: vi.fn().mockResolvedValue({ id: 'document_1' }),
      },
      workflowExecution: {
        create: vi.fn().mockResolvedValue({ id: 'workflow_1' }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      upload: {
        update: vi.fn().mockResolvedValue({ id: 'upload_1', status: UploadStatus.FAILED }),
      },
      document: {
        update: vi.fn().mockResolvedValue({ id: 'document_1', status: DocumentStatus.FAILED }),
      },
      workflowExecution: {
        update: vi.fn().mockResolvedValue({ id: 'workflow_1', status: WorkflowStatus.ERROR }),
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
      auditService: {
        record: vi.fn(),
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

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.upload.create).toHaveBeenCalledOnce();
    expect(db.upload.update).toHaveBeenCalledWith({
      where: { id: 'upload_1' },
      data: {
        status: UploadStatus.FAILED,
        errorMessage: 'n8n unavailable',
      },
    });
    expect(db.document.update).toHaveBeenCalledWith({
      where: { id: 'document_1' },
      data: {
        status: 'FAILED',
      },
    });
    expect(db.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'workflow_1' },
      data: {
        status: WorkflowStatus.ERROR,
        errorMessage: 'n8n unavailable',
      },
    });
    expect(existsSync(uploadTestDirectory)).toBe(true);
    expect(readdirSync(uploadTestDirectory)).toHaveLength(0);
  });

  it('uses unique temp storage paths for same-name uploads', async () => {
    const tx = {
      upload: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'upload_1' })
          .mockResolvedValueOnce({ id: 'upload_2' }),
      },
      document: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'document_1' })
          .mockResolvedValueOnce({ id: 'document_2' }),
      },
      workflowExecution: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ id: 'workflow_1' })
          .mockResolvedValueOnce({ id: 'workflow_2' }),
      },
    };
    const db = {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      upload: {
        update: vi
          .fn()
          .mockResolvedValueOnce({ id: 'upload_1', status: UploadStatus.INGESTING })
          .mockResolvedValueOnce({ id: 'upload_2', status: UploadStatus.INGESTING }),
      },
      document: {
        update: vi
          .fn()
          .mockResolvedValueOnce({ id: 'document_1', status: DocumentStatus.INGESTING })
          .mockResolvedValueOnce({ id: 'document_2', status: DocumentStatus.INGESTING }),
      },
      workflowExecution: {
        update: vi
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
      auditService: {
        record: vi.fn().mockResolvedValue(undefined),
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
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          deletedAt: null,
        }),
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
      workflowExecution: {
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const auditService = {
      record: vi.fn().mockResolvedValue(undefined),
    };
    const ingestionService = {
      startDocumentIngestion: vi.fn(),
    };

    const service = new DocumentService({
      db: db as never,
      auditService: auditService as never,
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
    expect(auditService.record).toHaveBeenCalledWith({
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
    });
  });

  it('records reindex audit logging in the same transaction as workflow/document updates', async () => {
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
      },
      auditLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    };
    const db = {
      workflowExecution: {
        create: vi.fn().mockResolvedValue({
          id: 'workflow_1',
          status: WorkflowStatus.QUEUED,
        }),
        update: vi.fn(),
      },
      document: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'document_1',
          userId: 'user_1',
          uploadId: 'upload_1',
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
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(tx.workflowExecution.update).toHaveBeenCalledWith({
      where: { id: 'workflow_1' },
      data: {
        externalExecutionId: 'exec_123',
        status: WorkflowStatus.RUNNING,
      },
    });
    expect(tx.document.update).toHaveBeenCalledWith({
      where: { id: 'document_1' },
      data: {
        status: DocumentStatus.INGESTING,
      },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'document.reindex_requested',
        entityType: 'document',
        entityId: 'document_1',
        requestId: 'req_reindex',
        metadata: {
          workflowExecutionId: 'workflow_1',
          externalExecutionId: 'exec_123',
          uploadId: 'upload_1',
        },
      },
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
      where: { id: 'upload_1', userId: 'user_1' },
      data: { status: UploadStatus.COMPLETED },
    });
    expect(db.document.updateMany).toHaveBeenCalledWith({
      where: { id: 'document_1', userId: 'user_1' },
      data: { status: DocumentStatus.READY },
    });
  });
});
