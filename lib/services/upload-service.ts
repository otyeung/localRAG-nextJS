import 'server-only';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { UploadStatus, WorkflowStatus, type Upload } from '@prisma/client';

import { env } from '@/lib/config/env';
import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nIngestionService } from '@/lib/n8n/ingestion';
import { AuditService } from '@/lib/services/audit-service';
import { UploadValidationService } from '@/lib/services/upload-validation-service';
import { VirusScanService } from '@/lib/services/virus-scan-service';
import { mapN8nStatusToWorkflowStatus } from '@/lib/services/workflow-service';

type UploadDb = Pick<typeof prisma, 'upload' | 'document' | 'workflowExecution'>;

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

export class UploadService {
  constructor(
    private readonly dependencies: {
      db?: UploadDb;
      validationService?: Pick<UploadValidationService, 'validate'>;
      virusScanService?: Pick<VirusScanService, 'scanFile'>;
      ingestionService?: Pick<N8nIngestionService, 'startDocumentIngestion'>;
      auditService?: Pick<AuditService, 'record'>;
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

  private get auditService(): Pick<AuditService, 'record'> {
    return this.dependencies.auditService ?? new AuditService();
  }

  private get uploadConfig(): { maxBytes: number; tempDirectory: string } {
    return this.dependencies.uploadConfig ?? env.upload;
  }

  async createUpload(input: CreateUploadInput): Promise<UploadResult> {
    const validation = await this.validationService.validate({
      fileName: input.fileName,
      mimeType: input.mimeType,
      size: input.bytes.byteLength,
    });

    const storagePath = await this.persistUploadBytes(input.fileName, input.bytes);
    await this.virusScanService.scanFile(storagePath);
    const fileHash = createFileHash(input.bytes);

    const upload = await this.db.upload.create({
      data: {
        userId: input.userId,
        status: UploadStatus.VALIDATING,
        originalFilename: input.fileName,
        mimeType: validation.normalizedMimeType,
        fileSizeBytes: input.bytes.byteLength,
        fileHash,
        storagePath,
      },
    });

    const document = await this.db.document.create({
      data: {
        userId: input.userId,
        uploadId: upload.id,
        title: this.buildDocumentTitle(input.fileName),
        originalFilename: input.fileName,
        mimeType: validation.normalizedMimeType,
        fileSizeBytes: input.bytes.byteLength,
        fileHash,
        storagePath,
        status: 'PENDING',
      },
    });

    const workflow = await this.db.workflowExecution.create({
      data: {
        userId: input.userId,
        uploadId: upload.id,
        documentId: document.id,
        workflowKey: 'ingestion',
        status: WorkflowStatus.QUEUED,
      },
    });

    try {
      const startResult = await this.ingestionService.startDocumentIngestion({
        documentId: document.id,
        uploadId: upload.id,
        filePath: storagePath,
        fileName: input.fileName,
        mimeType: validation.normalizedMimeType,
        requestId: input.requestId,
      });
      const nextWorkflowStatus = mapN8nStatusToWorkflowStatus(startResult.status);

      await Promise.all([
        this.db.upload.update({
          where: { id: upload.id },
          data: {
            status: mapWorkflowStatusToUploadStatus(nextWorkflowStatus),
          },
        }),
        this.db.document.update({
          where: { id: document.id },
          data: {
            status: mapWorkflowStatusToDocumentStatus(nextWorkflowStatus),
          },
        }),
      ]);

      const updatedWorkflow = await this.db.workflowExecution.update({
        where: { id: workflow.id },
        data: {
          externalExecutionId: startResult.executionId,
          status: nextWorkflowStatus,
          metadata: {
            workflowId: startResult.workflowId,
          },
        },
      });

      await this.auditService.record({
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
      });

      return {
        uploadId: upload.id,
        documentId: document.id,
        workflowExecutionId: workflow.id,
        externalExecutionId: updatedWorkflow.externalExecutionId,
        status: updatedWorkflow.status,
        storagePath,
      };
    } catch (error) {
      await Promise.all([
        this.db.upload.update({
          where: { id: upload.id },
          data: {
            status: UploadStatus.FAILED,
            errorMessage: error instanceof Error ? error.message : 'Upload ingestion failed.',
          },
        }),
        this.db.document.update({
          where: { id: document.id },
          data: {
            status: 'FAILED',
          },
        }),
        this.db.workflowExecution.update({
          where: { id: workflow.id },
          data: {
            status: WorkflowStatus.ERROR,
            errorMessage: error instanceof Error ? error.message : 'Upload ingestion failed.',
          },
        }),
      ]);

      throw error instanceof AppError ? error : new AppError('UPSTREAM_ERROR', 'Unable to start document ingestion.');
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
    const storedFileName = `${Date.now()}-${safeFileName(fileName)}`;
    const storagePath = resolve(targetDirectory, storedFileName);
    await writeFile(storagePath, Buffer.from(bytes));
    return storagePath;
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
