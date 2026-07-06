import 'server-only';

import {
  DocumentStatus,
  Prisma,
  UploadStatus,
  WorkflowStatus,
  type PrismaClient,
  type WorkflowExecution,
} from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';

type IngestionCallbackDb = Pick<
  typeof prisma,
  '$transaction' | 'document' | 'workflowExecution'
>;
type IngestionCallbackTransactionDb = Pick<
  Prisma.TransactionClient,
  | 'auditLog'
  | 'chunkMetadata'
  | 'document'
  | 'embeddingMetadata'
  | 'upload'
  | 'workflowExecution'
>;
type TransactionRunner = Pick<PrismaClient, '$transaction'>;

const ACTIVE_WORKFLOW_STATUSES = [
  WorkflowStatus.QUEUED,
  WorkflowStatus.RUNNING,
  WorkflowStatus.WAITING,
] as const;
const MAX_DOCUMENT_SEARCH_TEXT_CHARS = 4_000;

export type IngestionCallbackChunkInput = {
  chunkIndex: number;
  content: string;
  tokenCount?: number | null;
  pointId?: string | null;
};

export type CompleteIngestionInput = {
  documentId: string;
  uploadId: string;
  externalExecutionId?: string | null;
  workflowId?: string | null;
  completedAt?: string | null;
  embeddingModel?: string | null;
  chunks: IngestionCallbackChunkInput[];
};

export type CompleteIngestionResult = {
  documentId: string;
  uploadId: string;
  workflowExecutionId: string | null;
  status: 'READY';
  chunkCount: number;
};

type CallbackDocument = NonNullable<
  Awaited<ReturnType<IngestionCallbackDb['document']['findFirst']>>
>;

function normalizeCompletedAt(value: string | null | undefined): Date {
  if (!value) {
    return new Date();
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'Invalid ingestion callback completion timestamp.');
  }

  return date;
}

function assertUniqueChunkIndexes(chunks: IngestionCallbackChunkInput[]): void {
  const seen = new Set<number>();

  for (const chunk of chunks) {
    if (seen.has(chunk.chunkIndex)) {
      throw new AppError('VALIDATION_ERROR', 'Ingestion callback chunks must have unique indexes.');
    }
    seen.add(chunk.chunkIndex);
  }
}

function sanitizeTextForPostgres(value: string): string {
  return value.replace(/\u0000/g, ' ');
}

function normalizeChunksForPersistence(
  chunks: IngestionCallbackChunkInput[],
): IngestionCallbackChunkInput[] {
  return chunks.map((chunk) => ({
    ...chunk,
    content: sanitizeTextForPostgres(chunk.content),
  }));
}

function toMetadataRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return { ...(metadata as Record<string, unknown>) };
}

function buildSearchText(document: CallbackDocument, chunks: IngestionCallbackChunkInput[]): string {
  const searchText = [document.title, document.originalFilename, chunks.map((chunk) => chunk.content).join('\n\n')]
    .filter((value) => value.trim().length > 0)
    .join('\n');

  return searchText.slice(0, MAX_DOCUMENT_SEARCH_TEXT_CHARS);
}

function buildDocumentMetadata(
  metadata: unknown,
  input: CompleteIngestionInput,
  completedAt: Date,
): Prisma.InputJsonObject {
  return {
    ...toMetadataRecord(metadata),
    ingestionCallback: {
      completedAt: completedAt.toISOString(),
      chunkCount: input.chunks.length,
      ...(input.externalExecutionId ? { externalExecutionId: input.externalExecutionId } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
    },
  } as Prisma.InputJsonObject;
}

function buildWorkflowMetadata(
  workflow: WorkflowExecution,
  input: CompleteIngestionInput,
  completedAt: Date,
): Prisma.InputJsonObject {
  const metadata = toMetadataRecord(workflow.metadata);

  delete metadata.reconciliationHealth;
  delete metadata.reconciliationIssue;
  delete metadata.reconciliationSource;
  delete metadata.lastReconciliationAttemptAt;
  delete metadata.lastReconciliationFailureAt;

  return {
    ...metadata,
    reconciliationRequired: false,
    ingestionCallbackAt: completedAt.toISOString(),
    chunkCount: input.chunks.length,
    ...(input.workflowId ? { workflowId: input.workflowId } : {}),
  } as Prisma.InputJsonObject;
}

export class IngestionCallbackService {
  constructor(
    private readonly dependencies: {
      db?: IngestionCallbackDb;
      transactionRunner?: TransactionRunner;
    } = {},
  ) {}

  private get db(): IngestionCallbackDb {
    return this.dependencies.db ?? prisma;
  }

  private get transactionRunner(): TransactionRunner {
    if (this.dependencies.transactionRunner) {
      return this.dependencies.transactionRunner;
    }

    const db = this.dependencies.db as Partial<TransactionRunner> | undefined;
    if (typeof db?.$transaction === 'function') {
      return db as TransactionRunner;
    }

    return prisma;
  }

  async completeIngestion(input: CompleteIngestionInput): Promise<CompleteIngestionResult> {
    assertUniqueChunkIndexes(input.chunks);

    const sortedChunks = normalizeChunksForPersistence(input.chunks).sort(
      (left, right) => left.chunkIndex - right.chunkIndex,
    );
    const completedAt = normalizeCompletedAt(input.completedAt);
    const document = await this.db.document.findFirst({
      where: {
        id: input.documentId,
        uploadId: input.uploadId,
        deletedAt: null,
      },
    });

    if (!document) {
      throw new AppError('NOT_FOUND', 'Document not found for ingestion callback.');
    }

    const workflow = await this.findWorkflow(document.userId, input);
    const extractedText = sortedChunks.map((chunk) => chunk.content).join('\n\n');
    const pointIds = sortedChunks
      .map((chunk) => chunk.pointId?.trim())
      .filter((pointId): pointId is string => Boolean(pointId));

    await this.transactionRunner.$transaction(async (transaction) => {
      const tx = transaction as IngestionCallbackTransactionDb;

      await tx.chunkMetadata.deleteMany({
        where: { documentId: document.id },
      });
      await tx.embeddingMetadata.deleteMany({
        where: { documentId: document.id },
      });
      await tx.chunkMetadata.createMany({
        data: sortedChunks.map((chunk) => ({
          documentId: document.id,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount ?? null,
          metadata: {
            ingestionCallback: true,
            ...(chunk.pointId ? { pointId: chunk.pointId } : {}),
          },
        })),
      });

      if (pointIds.length > 0) {
        await tx.embeddingMetadata.createMany({
          data: sortedChunks
            .filter((chunk) => chunk.pointId)
            .map((chunk) => ({
              documentId: document.id,
              chunkId: null,
              vectorStoreId: chunk.pointId as string,
              embeddingModel: input.embeddingModel ?? null,
              dimensions: null,
              metadata: {
                ingestionCallback: true,
                chunkIndex: chunk.chunkIndex,
              },
            })),
        });
      }

      await tx.upload.update({
        where: { id: input.uploadId },
        data: {
          status: UploadStatus.COMPLETED,
          errorMessage: null,
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: {
          status: DocumentStatus.READY,
          extractedText,
          searchText: buildSearchText(document, sortedChunks),
          metadata: buildDocumentMetadata(document.metadata, input, completedAt),
        },
      });

      if (workflow) {
        await tx.workflowExecution.update({
          where: { id: workflow.id },
          data: {
            status: WorkflowStatus.SUCCESS,
            errorMessage: null,
            completedAt,
            responsePayload: {
              chunkCount: sortedChunks.length,
              pointIds,
            },
            metadata: buildWorkflowMetadata(workflow, input, completedAt),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: document.userId,
          action: 'ingestion.completed',
          entityType: 'document',
          entityId: document.id,
          metadata: {
            uploadId: input.uploadId,
            workflowExecutionId: workflow?.id ?? null,
            externalExecutionId: input.externalExecutionId ?? null,
            chunkCount: sortedChunks.length,
          },
        },
      });
    });

    return {
      documentId: document.id,
      uploadId: input.uploadId,
      workflowExecutionId: workflow?.id ?? null,
      status: 'READY',
      chunkCount: sortedChunks.length,
    };
  }

  private async findWorkflow(
    userId: string,
    input: CompleteIngestionInput,
  ): Promise<WorkflowExecution | null> {
    if (input.externalExecutionId) {
      const workflow = await this.db.workflowExecution.findFirst({
        where: {
          userId,
          workflowKey: 'ingestion',
          externalExecutionId: input.externalExecutionId,
          OR: [{ documentId: input.documentId }, { uploadId: input.uploadId }],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      if (workflow) {
        return workflow;
      }
    }

    return this.db.workflowExecution.findFirst({
      where: {
        userId,
        workflowKey: 'ingestion',
        OR: [{ documentId: input.documentId }, { uploadId: input.uploadId }],
        status: {
          in: [...ACTIVE_WORKFLOW_STATUSES],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
