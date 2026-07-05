import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { basename, parse, resolve } from 'node:path';

import { UploadStatus, WorkflowStatus, type PrismaClient, type Upload } from '@prisma/client';

import { env } from '@/lib/config/env';
import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nIngestionService } from '@/lib/n8n/ingestion';
import { UploadValidationService } from '@/lib/services/upload-validation-service';
import { VirusScanService } from '@/lib/services/virus-scan-service';
import { mapN8nStatusToWorkflowStatus } from '@/lib/services/workflow-service';

type UploadDb = Pick<typeof prisma, 'upload' | 'document' | 'workflowExecution' | 'auditLog'>;
type UploadTransactionDb = Pick<typeof prisma, 'upload' | 'document' | 'workflowExecution'>;
type AcceptedUploadStateTransactionDb = Pick<typeof prisma, 'upload' | 'document' | 'workflowExecution' | 'auditLog'>;
type UploadReconciliationTransactionDb = Pick<typeof prisma, 'workflowExecution' | 'auditLog'>;
type TransactionRunner = Pick<PrismaClient, '$transaction'>;

export type CreateUploadInput = {
  userId: string;
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export type UploadResult = {
  uploadId: string;
  documentId: string;
  workflowExecutionId: string;
  externalExecutionId: string | null;
  status: keyof typeof WorkflowStatus;
  storagePath: string;
  reconciliationRequired: boolean;
};

export type PublicUploadResult = {
  uploadId: string;
  documentId: string;
  workflowExecutionId: string;
  status: keyof typeof WorkflowStatus;
  reconciliationRequired: boolean;
};

export type UploadHistoryItem = {
  id: string;
  status: keyof typeof UploadStatus;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
};

function createFileHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function safeFileName(fileName: string): string {
  return basename(fileName).replace(/[^A-Za-z0-9._-]/g, '_');
}

function sanitizeFileStem(stem: string): string {
  return stem.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}

function sanitizeExtension(extension: string): string {
  return extension.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function mapWorkflowStatusToUploadStatus(status: WorkflowStatus): UploadStatus {
  switch (status) {
    case WorkflowStatus.SUCCESS:
      return UploadStatus.COMPLETED;
    case WorkflowStatus.ERROR:
      return UploadStatus.FAILED;
    case WorkflowStatus.CANCELED:
      return UploadStatus.CANCELED;
    default:
      return UploadStatus.INGESTING;
  }
}

function mapWorkflowStatusToDocumentStatus(status: WorkflowStatus): 'READY' | 'FAILED' | 'INGESTING' {
  switch (status) {
    case WorkflowStatus.SUCCESS:
      return 'READY';
    case WorkflowStatus.ERROR:
    case WorkflowStatus.CANCELED:
      return 'FAILED';
    default:
      return 'INGESTING';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export function toPublicUploadResult(upload: UploadResult): PublicUploadResult {
  return {
    uploadId: upload.uploadId,
    documentId: upload.documentId,
    workflowExecutionId: upload.workflowExecutionId,
    status: upload.status,
    reconciliationRequired: upload.reconciliationRequired,
  };
}

export class UploadService {
  constructor(
    private readonly dependencies: {
      db?: UploadDb;
      validationService?: Pick<UploadValidationService, 'validate'>;
      virusScanService?: Pick<VirusScanService, 'scanFile'>;
      ingestionService?: Pick<N8nIngestionService, 'startDocumentIngestion'>;
      transactionRunner?: TransactionRunner;
      uploadConfig?: {
        maxBytes: number;
        tempDirectory: string;
      };
    } = {},
  ) {}

  private get db(): UploadDb {
    return this.dependencies.db ?? prisma;
  }

  private get validationService(): Pick<UploadValidationService, 'validate'> {
    return this.dependencies.validationService ?? new UploadValidationService({ maxBytes: this.uploadConfig.maxBytes });
  }

  private get virusScanService(): Pick<VirusScanService, 'scanFile'> {
    return this.dependencies.virusScanService ?? new VirusScanService();
  }

  private get ingestionService(): Pick<N8nIngestionService, 'startDocumentIngestion'> {
    return this.dependencies.ingestionService ?? new N8nIngestionService();
  }

  private get uploadConfig(): { maxBytes: number; tempDirectory: string } {
    return this.dependencies.uploadConfig ?? env.upload;
  }

  private get transactionRunner(): TransactionRunner {
    if (this.dependencies.transactionRunner) {
      return this.dependencies.transactionRunner;
    }

    const db = this.dependencies.db as Partial<TransactionRunner> | undefined;
    if (db?.$transaction) {
      return db as TransactionRunner;
    }

    return prisma;
  }

  async createUpload(input: CreateUploadInput): Promise<UploadResult> {
    const validation = await this.validationService.validate({
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.bytes.byteLength,
    });

    const storagePath = await this.persistUploadBytes(input.fileName, input.bytes);
    let upload: { id: string };
    let document: { id: string };
    let workflow: { id: string };

    try {
      await this.virusScanService.scanFile(storagePath);
      const fileHash = createFileHash(input.bytes);
      ({ upload, document, workflow } = await this.createUploadRecords({
        userId: input.userId,
        fileName: input.fileName,
        mimeType: validation.normalizedMimeType,
        fileSizeBytes: input.bytes.byteLength,
        fileHash,
        storagePath,
      }));
    } catch (error) {
      await this.removeTempFile(storagePath);
      throw error;
    }

    let startResult: Awaited<ReturnType<Pick<N8nIngestionService, 'startDocumentIngestion'>['startDocumentIngestion']>>;
    try {
      startResult = await this.ingestionService.startDocumentIngestion({
        documentId: document.id,
        uploadId: upload.id,
        filePath: storagePath,
        fileName: input.fileName,
        mimeType: validation.normalizedMimeType,
        requestId: input.requestId,
      });
    } catch (error) {
      const failureMessage = errorMessage(error);
      await this.transactionRunner.$transaction(async (transaction: AcceptedUploadStateTransactionDb) => {
        await transaction.upload.update({
          where: { id: upload.id },
          data: {
            status: UploadStatus.FAILED,
            errorMessage: failureMessage,
          },
        });

        await transaction.document.update({
          where: { id: document.id },
          data: {
            status: 'FAILED',
          },
        });

        await transaction.workflowExecution.update({
          where: { id: workflow.id },
          data: {
            status: WorkflowStatus.ERROR,
            errorMessage: failureMessage,
          },
        });

        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: 'upload.ingestion_start_failed',
            entityType: 'upload',
            entityId: upload.id,
            requestId: input.requestId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: {
              documentId: document.id,
              workflowExecutionId: workflow.id,
              error: failureMessage,
            },
          },
        }).catch(() => undefined);
      });

      await this.removeTempFile(storagePath);
      throw error instanceof AppError ? error : new AppError('UPSTREAM_ERROR', 'Unable to start document ingestion.');
    }

    const nextWorkflowStatus = mapN8nStatusToWorkflowStatus(startResult.status);

    try {
      const updatedWorkflow = await this.transactionRunner.$transaction(
        async (transaction: AcceptedUploadStateTransactionDb) => {
          await transaction.upload.update({
            where: { id: upload.id },
            data: {
              status: mapWorkflowStatusToUploadStatus(nextWorkflowStatus),
            },
          });

          await transaction.document.update({
            where: { id: document.id },
            data: {
              status: mapWorkflowStatusToDocumentStatus(nextWorkflowStatus),
            },
          });

          const updatedWorkflow = await transaction.workflowExecution.update({
            where: { id: workflow.id },
            data: {
              externalExecutionId: startResult.executionId,
              status: nextWorkflowStatus,
              metadata: {
                workflowId: startResult.workflowId,
              },
            },
          });

          await transaction.auditLog.create({
            data: {
              userId: input.userId,
              action: 'upload.created',
              entityType: 'upload',
              entityId: upload.id,
              requestId: input.requestId,
              ipAddress: input.ipAddress,
              userAgent: input.userAgent,
              metadata: {
                documentId: document.id,
                workflowExecutionId: workflow.id,
                externalExecutionId: startResult.executionId,
              },
            },
          });

          return updatedWorkflow;
        },
      );

      return {
        uploadId: upload.id,
        documentId: document.id,
        workflowExecutionId: workflow.id,
        externalExecutionId: updatedWorkflow.externalExecutionId,
        status: updatedWorkflow.status,
        storagePath,
        reconciliationRequired: false,
      };
    } catch (error) {
      const localPersistenceError = errorMessage(error);
      const reconciledWorkflow = await this.transactionRunner.$transaction(
        async (transaction: UploadReconciliationTransactionDb) => {
          const updatedWorkflow = await transaction.workflowExecution.update({
            where: { id: workflow.id },
            data: {
              externalExecutionId: startResult.executionId,
              status: nextWorkflowStatus,
              metadata: {
                workflowId: startResult.workflowId,
                reconciliationRequired: true,
                localPersistenceError,
              },
            },
          });

          await transaction.auditLog.create({
            data: {
              userId: input.userId,
              action: 'upload.ingestion_reconciliation_required',
              entityType: 'upload',
              entityId: upload.id,
              requestId: input.requestId,
              ipAddress: input.ipAddress,
              userAgent: input.userAgent,
              metadata: {
                documentId: document.id,
                workflowExecutionId: workflow.id,
                externalExecutionId: startResult.executionId,
                error: localPersistenceError,
              },
            },
          }).catch(() => undefined);

          return updatedWorkflow;
        },
      );

      return {
        uploadId: upload.id,
        documentId: document.id,
        workflowExecutionId: workflow.id,
        externalExecutionId: reconciledWorkflow.externalExecutionId,
        status: reconciledWorkflow.status,
        storagePath,
        reconciliationRequired: true,
      };
    }
  }

  async listUploads(userId: string): Promise<UploadHistoryItem[]> {
    const uploads = await this.db.upload.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return uploads.map((upload: Upload) => ({
      id: upload.id,
      status: upload.status,
      originalFilename: upload.originalFilename,
      mimeType: upload.mimeType,
      fileSizeBytes: upload.fileSizeBytes,
      createdAt: upload.createdAt.toISOString(),
      updatedAt: upload.updatedAt.toISOString(),
      errorMessage: upload.errorMessage,
    }));
  }

  private async persistUploadBytes(fileName: string, bytes: Uint8Array): Promise<string> {
    const targetDirectory = resolve(this.uploadConfig.tempDirectory);
    await mkdir(targetDirectory, { recursive: true });
    const storedFileName = this.buildStoredFileName(fileName);
    const storagePath = resolve(targetDirectory, storedFileName);
    await writeFile(storagePath, Buffer.from(bytes));
    return storagePath;
  }

  private async createUploadRecords(input: {
    userId: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: number;
    fileHash: string;
    storagePath: string;
  }): Promise<{
    upload: { id: string };
    document: { id: string };
    workflow: { id: string };
  }> {
    return this.transactionRunner.$transaction(async (transaction: UploadTransactionDb) => {
      const upload = await transaction.upload.create({
        data: {
          userId: input.userId,
          status: UploadStatus.VALIDATING,
          originalFilename: input.fileName,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes,
          fileHash: input.fileHash,
          storagePath: input.storagePath,
        },
      });

      const document = await transaction.document.create({
        data: {
          userId: input.userId,
          uploadId: upload.id,
          title: this.buildDocumentTitle(input.fileName),
          originalFilename: input.fileName,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes,
          fileHash: input.fileHash,
          storagePath: input.storagePath,
          status: 'PENDING',
        },
      });

      const workflow = await transaction.workflowExecution.create({
        data: {
          userId: input.userId,
          uploadId: upload.id,
          documentId: document.id,
          workflowKey: 'ingestion',
          status: WorkflowStatus.QUEUED,
        },
      });

      return { upload, document, workflow };
    });
  }

  private buildStoredFileName(fileName: string): string {
    const parsed = parse(safeFileName(fileName));
    const stem = sanitizeFileStem(parsed.name) || 'upload';
    const extension = sanitizeExtension(parsed.ext.startsWith('.') ? parsed.ext.slice(1) : parsed.ext);
    const uniqueId = randomUUID();

    return extension ? `${stem}-${uniqueId}.${extension}` : `${stem}-${uniqueId}`;
  }

  private async removeTempFile(storagePath: string): Promise<void> {
    try {
      await unlink(storagePath);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return;
      }

      throw error;
    }
  }

  private buildDocumentTitle(fileName: string): string {
    const normalizedFileName = basename(fileName);
    const dotIndex = normalizedFileName.lastIndexOf('.');

    if (dotIndex <= 0) {
      return normalizedFileName;
    }

    return normalizedFileName.slice(0, dotIndex);
  }
}
