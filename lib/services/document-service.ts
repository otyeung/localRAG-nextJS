import 'server-only';

import { DocumentStatus, WorkflowStatus, type Document, type PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nIngestionService } from '@/lib/n8n/ingestion';
import { AuditService, type AuditEventInput } from '@/lib/services/audit-service';
import { mapN8nStatusToWorkflowStatus } from '@/lib/services/workflow-service';

type DocumentDb = Pick<typeof prisma, 'document' | 'workflowExecution'>;
type DocumentTransactionDb = Pick<typeof prisma, 'workflowExecution' | 'document' | 'auditLog'>;
type TransactionRunner = Pick<PrismaClient, '$transaction'>;

export type DocumentDto = {
  id: string;
  uploadId: string;
  status: keyof typeof DocumentStatus;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  storagePath: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type DocumentQuery = {
  search?: string;
  status?: keyof typeof DocumentStatus;
  sort?: 'createdAt' | 'updatedAt' | 'title';
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export type DocumentListResult = {
  items: DocumentDto[];
  total: number;
  page: number;
  pageSize: number;
};

function toDocumentDto(document: Document): DocumentDto {
  return {
    id: document.id,
    uploadId: document.uploadId,
    status: document.status,
    title: document.title,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    fileHash: document.fileHash,
    storagePath: document.storagePath,
    metadata: document.metadata,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
}

function mapWorkflowStatusToDocumentStatus(status: WorkflowStatus): DocumentStatus {
  switch (status) {
    case WorkflowStatus.SUCCESS:
      return DocumentStatus.READY;
    case WorkflowStatus.ERROR:
    case WorkflowStatus.CANCELED:
      return DocumentStatus.FAILED;
    default:
      return DocumentStatus.INGESTING;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export class DocumentService {
  constructor(
    private readonly dependencies: {
      db?: DocumentDb;
      auditService?: Pick<AuditService, 'record'>;
      ingestionService?: Pick<N8nIngestionService, 'startDocumentIngestion'>;
      transactionRunner?: TransactionRunner;
    } = {},
  ) {}

  private get db(): DocumentDb {
    return this.dependencies.db ?? prisma;
  }

  private get auditService(): Pick<AuditService, 'record'> {
    return this.dependencies.auditService ?? new AuditService();
  }

  private get ingestionService(): Pick<N8nIngestionService, 'startDocumentIngestion'> {
    return this.dependencies.ingestionService ?? new N8nIngestionService();
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

  async listDocuments(userId: string, query: DocumentQuery): Promise<DocumentListResult> {
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const search = query.search?.trim();
    const status = query.status ? DocumentStatus[query.status] : undefined;
    const where = {
      userId,
      deletedAt: null,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { originalFilename: { contains: search, mode: 'insensitive' as const } },
              { searchText: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const sort = query.sort ?? 'updatedAt';
    const order = query.order ?? 'desc';

    const [items, total] = await Promise.all([
      this.db.document.findMany({
        where,
        orderBy: { [sort]: order },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.document.count({ where }),
    ]);

    return {
      items: items.map(toDocumentDto),
      total,
      page,
      pageSize,
    };
  }

  async getDocument(userId: string, documentId: string): Promise<DocumentDto> {
    const document = await this.db.document.findFirst({
      where: {
        id: documentId,
        userId,
        deletedAt: null,
      },
    });

    if (!document) {
      throw new AppError('NOT_FOUND', 'Document not found.');
    }

    return toDocumentDto(document);
  }

  async softDeleteDocument(userId: string, documentId: string, auditContext: Omit<AuditEventInput, 'action' | 'entityType' | 'entityId' | 'userId'>): Promise<DocumentDto> {
    const document = await this.db.document.findFirst({
      where: {
        id: documentId,
        userId,
        deletedAt: null,
      },
    });

    if (!document) {
      throw new AppError('NOT_FOUND', 'Document not found.');
    }

    const deleted = await this.db.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.DELETED,
        deletedAt: new Date(),
      },
    });

    await this.auditService.record({
      userId,
      action: 'document.deleted',
      entityType: 'document',
      entityId: documentId,
      requestId: auditContext.requestId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: {
        title: document.title,
        originalFilename: document.originalFilename,
      },
    });

    return toDocumentDto(deleted);
  }

  async requestReindex(userId: string, documentId: string, requestId?: string): Promise<{ workflowExecutionId: string; externalExecutionId: string | null; status: keyof typeof WorkflowStatus }> {
    const document = await this.db.document.findFirst({
      where: {
        id: documentId,
        userId,
        deletedAt: null,
      },
    });

    if (!document) {
      throw new AppError('NOT_FOUND', 'Document not found.');
    }

    const workflow = await this.db.workflowExecution.create({
      data: {
        userId,
        documentId: document.id,
        uploadId: document.uploadId,
        workflowKey: 'ingestion',
        status: WorkflowStatus.QUEUED,
      },
    });

    let startResult: Awaited<ReturnType<Pick<N8nIngestionService, 'startDocumentIngestion'>['startDocumentIngestion']>>;
    try {
      startResult = await this.ingestionService.startDocumentIngestion({
        documentId: document.id,
        uploadId: document.uploadId,
        filePath: document.storagePath,
        fileName: document.originalFilename,
        mimeType: document.mimeType,
        requestId,
      });
    } catch (error) {
      await this.db.workflowExecution.update({
        where: { id: workflow.id },
        data: {
          status: WorkflowStatus.ERROR,
          errorMessage: errorMessage(error),
        },
      });

      throw error instanceof AppError ? error : new AppError('UPSTREAM_ERROR', 'Unable to start document ingestion.');
    }

    const nextWorkflowStatus = mapN8nStatusToWorkflowStatus(startResult.status);

    try {
      const updatedWorkflow = await this.transactionRunner.$transaction(async (transaction: DocumentTransactionDb) => {
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

        await transaction.document.update({
          where: { id: document.id },
          data: {
            status: mapWorkflowStatusToDocumentStatus(nextWorkflowStatus),
          },
        });

        await transaction.auditLog.create({
          data: {
            userId,
            action: 'document.reindex_requested',
            entityType: 'document',
            entityId: document.id,
            requestId,
            metadata: {
              workflowExecutionId: workflow.id,
              externalExecutionId: startResult.executionId,
              uploadId: document.uploadId,
            },
          },
        });

        return updatedWorkflow;
      });

      return {
        workflowExecutionId: updatedWorkflow.id,
        externalExecutionId: updatedWorkflow.externalExecutionId,
        status: updatedWorkflow.status,
      };
    } catch (error) {
      await this.db.workflowExecution.update({
        where: { id: workflow.id },
        data: {
          externalExecutionId: startResult.executionId,
          status: nextWorkflowStatus,
          metadata: {
            workflowId: startResult.workflowId,
            reconciliationRequired: true,
            localPersistenceError: errorMessage(error),
          },
        },
      });

      throw new AppError(
        'INTERNAL_ERROR',
        'Document ingestion started, but local state reconciliation is required.',
      );
    }
  }
}
