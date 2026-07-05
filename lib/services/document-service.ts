import 'server-only';

import { DocumentStatus, Prisma, WorkflowStatus, type PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nIngestionService } from '@/lib/n8n/ingestion';
import type { N8nWorkflowStartResult } from '@/lib/n8n/types';
import type { AuditEventInput } from '@/lib/services/audit-service';
import { mapN8nStatusToWorkflowStatus } from '@/lib/services/workflow-service';

type DocumentDb = Pick<typeof prisma, 'document' | 'workflowExecution' | 'auditLog'>;
type DocumentTransactionDb = Pick<Prisma.TransactionClient, 'workflowExecution' | 'document' | 'auditLog'> &
  Partial<Pick<Prisma.TransactionClient, '$executeRawUnsafe'>>;
type TransactionRunner = Pick<PrismaClient, '$transaction'>;
type ActiveWorkflowSummary = {
  id: string;
  status: WorkflowStatus;
  externalExecutionId: string | null;
};

const ACTIVE_DOCUMENT_WORKFLOW_STATUSES = [WorkflowStatus.QUEUED, WorkflowStatus.RUNNING, WorkflowStatus.WAITING] as const;

export type DocumentDto = {
  id: string;
  uploadId: string;
  status: keyof typeof DocumentStatus;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  chunkCount: number;
  fileHash: string;
  storagePath: string;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type PublicDocumentDto = {
  id: string;
  uploadId: string;
  status: keyof typeof DocumentStatus;
  title: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ReindexResult = {
  workflowExecutionId: string;
  externalExecutionId: string | null;
  status: keyof typeof WorkflowStatus;
};

export type PublicReindexResult = {
  workflowExecutionId: string;
  status: keyof typeof WorkflowStatus;
  reconciliationRequired: boolean;
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

type DocumentWithChunkCount = Prisma.DocumentGetPayload<{
  include: {
    _count: {
      select: {
        chunks: true;
      };
    };
  };
}>;

function toDocumentDto(document: DocumentWithChunkCount): DocumentDto {
  return {
    id: document.id,
    uploadId: document.uploadId,
    status: document.status,
    title: document.title,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    chunkCount: document._count.chunks,
    fileHash: document.fileHash,
    storagePath: document.storagePath,
    metadata: document.metadata,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  };
}

export function toPublicDocumentDto(document: DocumentDto): PublicDocumentDto {
  return {
    id: document.id,
    uploadId: document.uploadId,
    status: document.status,
    title: document.title,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    fileSizeBytes: document.fileSizeBytes,
    chunkCount: document.chunkCount,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    deletedAt: document.deletedAt,
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

function buildReindexWorkflowMetadata(
  previousDocumentStatus: DocumentStatus,
  overrides: Record<string, Prisma.InputJsonValue | undefined> = {},
): Prisma.InputJsonObject {
  return {
    operation: 'reindex',
    previousDocumentStatus,
    ...overrides,
  } as Prisma.InputJsonObject;
}

function createResourceId(): string {
  return nanoid();
}

function buildActiveWorkflowConflict(documentId: string, workflow: ActiveWorkflowSummary): AppError {
  return new AppError('CONFLICT', 'A document ingestion workflow is already active for this document.', {
    reason: 'ACTIVE_WORKFLOW',
    documentId,
    workflowExecutionId: workflow.id,
    workflowStatus: workflow.status,
  });
}

export class DocumentService {
  constructor(
    private readonly dependencies: {
      db?: DocumentDb;
      ingestionService?: Pick<N8nIngestionService, 'startDocumentIngestion'>;
      transactionRunner?: TransactionRunner;
    } = {},
  ) {}

  private get db(): DocumentDb {
    return this.dependencies.db ?? prisma;
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

  private async lockDocumentForReindex(transaction: DocumentTransactionDb, documentId: string): Promise<void> {
    if (typeof transaction.$executeRawUnsafe !== 'function') {
      return;
    }

    await transaction.$executeRawUnsafe('SELECT 1 FROM "Document" WHERE "id" = $1 FOR UPDATE', documentId);
  }

  private async findActiveDocumentWorkflow(
    transaction: DocumentTransactionDb,
    userId: string,
    documentId: string,
  ): Promise<ActiveWorkflowSummary | null> {
    if (typeof transaction.workflowExecution.findFirst !== 'function') {
      return null;
    }

    const workflow = await transaction.workflowExecution.findFirst({
      where: {
        userId,
        documentId,
        workflowKey: 'ingestion',
        status: {
          in: [...ACTIVE_DOCUMENT_WORKFLOW_STATUSES],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    if (!workflow) {
      return null;
    }

    return {
      id: workflow.id,
      status: workflow.status,
      externalExecutionId: workflow.externalExecutionId,
    };
  }

  private async createQueuedReindexWorkflow(
    transaction: DocumentTransactionDb,
    input: {
      workflowExecutionId: string;
      userId: string;
      documentId: string;
      uploadId: string;
      previousDocumentStatus: DocumentStatus;
    },
  ): Promise<ActiveWorkflowSummary> {
    const workflow = await transaction.workflowExecution.create({
      data: {
        id: input.workflowExecutionId,
        userId: input.userId,
        documentId: input.documentId,
        uploadId: input.uploadId,
        workflowKey: 'ingestion',
        status: WorkflowStatus.QUEUED,
        metadata: buildReindexWorkflowMetadata(input.previousDocumentStatus),
      },
    });

    return {
      id: workflow.id,
      status: workflow.status,
      externalExecutionId: workflow.externalExecutionId,
    };
  }

  private async persistAcceptedReindexWorkflow(
    transaction: DocumentTransactionDb,
    input: {
      workflowExecutionId: string;
      documentId: string;
      previousDocumentStatus: DocumentStatus;
      nextWorkflowStatus: WorkflowStatus;
      startResult: N8nWorkflowStartResult;
      localPersistenceError?: string;
    },
  ): Promise<ActiveWorkflowSummary> {
    const workflow = await transaction.workflowExecution.update({
      where: { id: input.workflowExecutionId },
      data: {
        externalExecutionId: input.startResult.executionId,
        status: input.nextWorkflowStatus,
        metadata: buildReindexWorkflowMetadata(input.previousDocumentStatus, {
          workflowId: input.startResult.workflowId ?? undefined,
          reconciliationRequired: input.localPersistenceError ? true : undefined,
          localPersistenceError: input.localPersistenceError,
        }),
      },
    });

    if (input.nextWorkflowStatus === WorkflowStatus.SUCCESS) {
      await transaction.document.update({
        where: { id: input.documentId },
        data: {
          status: mapWorkflowStatusToDocumentStatus(input.nextWorkflowStatus),
        },
      });
    }

    return {
      id: workflow.id,
      status: workflow.status,
      externalExecutionId: workflow.externalExecutionId,
    };
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
        include: {
          _count: {
            select: {
              chunks: true,
            },
          },
        },
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
      include: {
        _count: {
          select: {
            chunks: true,
          },
        },
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
      include: {
        _count: {
          select: {
            chunks: true,
          },
        },
      },
    });

    if (!document) {
      throw new AppError('NOT_FOUND', 'Document not found.');
    }

    const deleted = await this.transactionRunner.$transaction(async (transaction: DocumentTransactionDb) => {
      const deleted = await transaction.document.update({
        where: { id: documentId },
        data: {
          status: DocumentStatus.DELETED,
          deletedAt: new Date(),
        },
      });

      await transaction.auditLog.create({
        data: {
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
        },
      });

      return deleted;
    });

    return {
      ...toDocumentDto(document),
      status: deleted.status,
      updatedAt: deleted.updatedAt.toISOString(),
      deletedAt: deleted.deletedAt?.toISOString() ?? null,
    };
  }

  async requestReindex(userId: string, documentId: string, requestId?: string): Promise<ReindexResult> {
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

    const workflowExecutionId = createResourceId();

    await this.transactionRunner.$transaction(
      async (transaction: DocumentTransactionDb) => {
        await this.lockDocumentForReindex(transaction, document.id);

        const activeWorkflow = await this.findActiveDocumentWorkflow(transaction, userId, document.id);
        if (activeWorkflow) {
          throw buildActiveWorkflowConflict(document.id, activeWorkflow);
        }

        await this.createQueuedReindexWorkflow(transaction, {
          workflowExecutionId,
          userId,
          documentId: document.id,
          uploadId: document.uploadId,
          previousDocumentStatus: document.status,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    let startResult: N8nWorkflowStartResult;
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
      const startFailureMessage = errorMessage(error);

      try {
        await this.transactionRunner.$transaction(async (transaction: DocumentTransactionDb) => {
          await transaction.workflowExecution.update({
            where: { id: workflowExecutionId },
            data: {
              status: WorkflowStatus.ERROR,
              errorMessage: startFailureMessage,
            },
          });

          await transaction.auditLog.create({
            data: {
              userId,
              action: 'document.reindex_start_failed',
              entityType: 'document',
              entityId: document.id,
              requestId,
              metadata: {
                workflowExecutionId,
                uploadId: document.uploadId,
                error: startFailureMessage,
              },
            },
          });
        });
      } catch (persistenceError) {
        await this.db.workflowExecution.update({
          where: { id: workflowExecutionId },
          data: {
            status: WorkflowStatus.ERROR,
            errorMessage: startFailureMessage,
          },
        });

        throw persistenceError;
      }

      throw error instanceof AppError ? error : new AppError('UPSTREAM_ERROR', 'Unable to start document ingestion.');
    }

    const nextWorkflowStatus = mapN8nStatusToWorkflowStatus(startResult.status);

    try {
      const updatedWorkflow = await this.transactionRunner.$transaction(async (transaction: DocumentTransactionDb) => {
        const updatedWorkflow = await this.persistAcceptedReindexWorkflow(transaction, {
          workflowExecutionId,
          documentId: document.id,
          previousDocumentStatus: document.status,
          nextWorkflowStatus,
          startResult,
        });

        await transaction.auditLog.create({
          data: {
            userId,
            action: 'document.reindex_requested',
            entityType: 'document',
            entityId: document.id,
            requestId,
            metadata: {
              workflowExecutionId,
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
      const localPersistenceError = errorMessage(error);
      const reconciledWorkflow = await this.transactionRunner.$transaction(async (transaction: DocumentTransactionDb) =>
        this.persistAcceptedReindexWorkflow(transaction, {
          workflowExecutionId,
          documentId: document.id,
          previousDocumentStatus: document.status,
          nextWorkflowStatus,
          startResult,
          localPersistenceError,
        }),
      );

      try {
        await this.db.auditLog.create({
          data: {
            userId,
            action: 'document.reindex_reconciliation_required',
            entityType: 'document',
            entityId: document.id,
            requestId,
            metadata: {
              workflowExecutionId,
              externalExecutionId: reconciledWorkflow.externalExecutionId,
              uploadId: document.uploadId,
              error: localPersistenceError,
            },
          },
        });
      } catch {
        // Keep the persisted reconciliation marker even if the follow-up audit write fails.
      }

      throw new AppError(
        'INTERNAL_ERROR',
        'Document ingestion started, but local state reconciliation is required.',
      );
    }
  }

}

export function toPublicReindexResult(result: ReindexResult): PublicReindexResult {
  return {
    workflowExecutionId: result.workflowExecutionId,
    status: result.status,
    reconciliationRequired: result.externalExecutionId === null,
  };
}
