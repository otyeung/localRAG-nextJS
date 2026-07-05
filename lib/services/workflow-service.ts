import 'server-only';

import { Prisma, DocumentStatus, UploadStatus, WorkflowStatus, type WorkflowExecution } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nExecutionService } from '@/lib/n8n/executions';

type WorkflowDb = Pick<
  typeof prisma,
  '$transaction' | 'workflowExecution' | 'upload' | 'document' | 'auditLog'
>;

type WorkflowTransactionDb = Pick<
  Prisma.TransactionClient,
  'workflowExecution' | 'upload' | 'document' | 'auditLog'
>;

export type WorkflowExecutionDto = {
  id: string;
  workflowKey: string;
  status: keyof typeof WorkflowStatus;
  externalExecutionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  metadata: unknown;
  uploadId: string | null;
  documentId: string | null;
};

export type PublicWorkflowExecutionDto = {
  id: string;
  workflowKey: string;
  status: keyof typeof WorkflowStatus;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  uploadId: string | null;
  documentId: string | null;
  reconciliationRequired: boolean;
};

export type WorkflowListResult = {
  items: WorkflowExecutionDto[];
  total: number;
};

export type WorkflowListQuery = {
  documentIds?: string[];
  pageSize?: number;
};

export type PublicWorkflowListResult = {
  items: PublicWorkflowExecutionDto[];
  total: number;
};

const RECONCILIATION_HEALTH_DEGRADED = 'degraded' as const;
const RECONCILIATION_ISSUE_UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE' as const;
const RECONCILIATION_SOURCE_N8N_POLL = 'n8n_poll' as const;
const WORKFLOW_RECONCILED_ACTION = 'workflow.reconciled' as const;
const WORKFLOW_RECONCILIATION_ISSUE_ACTION = 'workflow.reconciliation_issue_recorded' as const;

export function mapN8nStatusToWorkflowStatus(status: string): WorkflowStatus {
  switch (status) {
    case 'running':
      return WorkflowStatus.RUNNING;
    case 'success':
      return WorkflowStatus.SUCCESS;
    case 'error':
    case 'crashed':
      return WorkflowStatus.ERROR;
    case 'canceled':
      return WorkflowStatus.CANCELED;
    case 'waiting':
      return WorkflowStatus.WAITING;
    case 'new':
    case 'unknown':
    default:
      return WorkflowStatus.QUEUED;
  }
}

function toWorkflowDto(workflow: WorkflowExecution): WorkflowExecutionDto {
  return {
    id: workflow.id,
    workflowKey: workflow.workflowKey,
    status: workflow.status,
    externalExecutionId: workflow.externalExecutionId,
    errorMessage: workflow.errorMessage,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
    startedAt: workflow.startedAt?.toISOString() ?? null,
    completedAt: workflow.completedAt?.toISOString() ?? null,
    requestPayload: workflow.requestPayload,
    responsePayload: workflow.responsePayload,
    metadata: workflow.metadata,
    uploadId: workflow.uploadId,
    documentId: workflow.documentId,
  };
}

export function toPublicWorkflowExecutionDto(workflow: WorkflowExecutionDto): PublicWorkflowExecutionDto {
  return {
    id: workflow.id,
    workflowKey: workflow.workflowKey,
    status: workflow.status,
    errorMessage: workflow.errorMessage,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    startedAt: workflow.startedAt,
    completedAt: workflow.completedAt,
    uploadId: workflow.uploadId,
    documentId: workflow.documentId,
    reconciliationRequired: isReconciliationRequired(workflow.metadata),
  };
}

function isReconciliationRequired(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }

  return metadata instanceof Object && 'reconciliationRequired' in metadata && metadata.reconciliationRequired === true;
}

function isReindexWorkflow(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }

  return metadata instanceof Object && 'operation' in metadata && metadata.operation === 'reindex';
}

function toMetadataRecord(metadata: unknown): Prisma.JsonObject | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  return { ...(metadata as Prisma.JsonObject) };
}

function hasPollFailureMarker(metadata: unknown): boolean {
  const record = toMetadataRecord(metadata);

  if (!record) {
    return false;
  }

  return (
    record.reconciliationSource === RECONCILIATION_SOURCE_N8N_POLL ||
    record.reconciliationIssue === RECONCILIATION_ISSUE_UPSTREAM_UNAVAILABLE ||
    record.reconciliationHealth === RECONCILIATION_HEALTH_DEGRADED
  );
}

function buildPollFailureMetadata(metadata: unknown, timestamp: string): Prisma.InputJsonObject {
  return {
    ...(toMetadataRecord(metadata) ?? {}),
    reconciliationRequired: true,
    reconciliationHealth: RECONCILIATION_HEALTH_DEGRADED,
    reconciliationIssue: RECONCILIATION_ISSUE_UPSTREAM_UNAVAILABLE,
    reconciliationSource: RECONCILIATION_SOURCE_N8N_POLL,
    lastReconciliationAttemptAt: timestamp,
    lastReconciliationFailureAt: timestamp,
  } as Prisma.InputJsonObject;
}

function clearPollFailureMetadata(metadata: unknown): Prisma.InputJsonObject {
  const record = toMetadataRecord(metadata);

  if (!record) {
    return {} as Prisma.InputJsonObject;
  }

  delete record.reconciliationHealth;
  delete record.reconciliationIssue;
  delete record.reconciliationSource;
  delete record.lastReconciliationFailureAt;

  if (!('localPersistenceError' in record)) {
    delete record.reconciliationRequired;
  }

  return (Object.keys(record).length > 0 ? record : {}) as Prisma.InputJsonObject;
}

function areDatesEqual(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return (left?.getTime() ?? null) === (right?.getTime() ?? null);
}

function areJsonValuesEqual(left: Prisma.JsonValue | null | undefined, right: Prisma.JsonValue | null | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function hasWorkflowStateChanged(
  workflow: WorkflowExecution,
  nextState: {
    status: WorkflowStatus;
    startedAt: Date | null;
    completedAt: Date | null;
    errorMessage: string | null;
    responsePayload: Prisma.JsonValue | null;
    metadata: Prisma.JsonValue | null;
  },
): boolean {
  return (
    workflow.status !== nextState.status ||
    !areDatesEqual(workflow.startedAt, nextState.startedAt) ||
    !areDatesEqual(workflow.completedAt, nextState.completedAt) ||
    workflow.errorMessage !== nextState.errorMessage ||
    !areJsonValuesEqual(workflow.responsePayload, nextState.responsePayload) ||
    !areJsonValuesEqual(workflow.metadata, nextState.metadata)
  );
}

function isActiveWorkflowStatus(status: WorkflowStatus): boolean {
  return status === WorkflowStatus.RUNNING || status === WorkflowStatus.WAITING || status === WorkflowStatus.QUEUED;
}

function mapWorkflowStatusToUploadStatus(status: WorkflowStatus): UploadStatus {
  if (status === WorkflowStatus.SUCCESS) {
    return UploadStatus.COMPLETED;
  }

  if (status === WorkflowStatus.CANCELED) {
    return UploadStatus.CANCELED;
  }

  if (status === WorkflowStatus.ERROR) {
    return UploadStatus.FAILED;
  }

  return UploadStatus.INGESTING;
}

function mapWorkflowStatusToDocumentStatus(status: WorkflowStatus): DocumentStatus {
  if (status === WorkflowStatus.SUCCESS) {
    return DocumentStatus.READY;
  }

  if (status === WorkflowStatus.ERROR || status === WorkflowStatus.CANCELED) {
    return DocumentStatus.FAILED;
  }

  return DocumentStatus.INGESTING;
}

type ResourceSyncResult = {
  uploadStatus?: UploadStatus;
  uploadUpdated: boolean;
  documentStatus?: DocumentStatus;
  documentUpdated: boolean;
};

export class WorkflowService {
  constructor(
    private readonly dependencies: {
      db?: WorkflowDb;
      executionService?: Pick<N8nExecutionService, 'pollExecution'>;
    } = {},
  ) {}

  private get db(): WorkflowDb {
    return this.dependencies.db ?? prisma;
  }

  private get executionService(): Pick<N8nExecutionService, 'pollExecution'> {
    return this.dependencies.executionService ?? new N8nExecutionService();
  }

  private get transactionRunner(): WorkflowDb {
    return (this.dependencies.db ?? prisma) as WorkflowDb;
  }

  async listWorkflows(userId: string, query: WorkflowListQuery = {}): Promise<WorkflowListResult> {
    const normalizedDocumentIds = Array.from(new Set(query.documentIds?.filter((documentId) => documentId.trim().length > 0) ?? []));

    if (normalizedDocumentIds.length > 0) {
      const items = await this.db.workflowExecution.findMany({
        where: {
          userId,
          documentId: {
            in: normalizedDocumentIds,
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const latestItems = items.filter((workflow, index) => {
        if (!workflow.documentId) {
          return false;
        }

        return items.findIndex((candidate) => candidate.documentId === workflow.documentId) === index;
      });
      const pagedItems = typeof query.pageSize === 'number' ? latestItems.slice(0, query.pageSize) : latestItems;
      const reconciledItems = await Promise.all(pagedItems.map(async (workflow) => this.reconcileWorkflow(userId, workflow)));

      return {
        items: reconciledItems.map(toWorkflowDto),
        total: latestItems.length,
      };
    }

    const [items, total] = await Promise.all([
      this.db.workflowExecution.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(typeof query.pageSize === 'number' ? { take: query.pageSize } : {}),
      }),
      this.db.workflowExecution.count({
        where: { userId },
      }),
    ]);

    const reconciledItems = await Promise.all(items.map(async (workflow) => this.reconcileWorkflow(userId, workflow)));

    return {
      items: reconciledItems.map(toWorkflowDto),
      total,
    };
  }

  async listPublicWorkflows(userId: string, query: WorkflowListQuery = {}): Promise<PublicWorkflowListResult> {
    const result = await this.listWorkflows(userId, query);

    return {
      items: result.items.map(toPublicWorkflowExecutionDto),
      total: result.total,
    };
  }

  async getWorkflowStatus(userId: string, workflowExecutionId: string): Promise<WorkflowExecutionDto> {
    const workflow = await this.db.workflowExecution.findFirst({
      where: {
        id: workflowExecutionId,
        userId,
      },
    });

    if (!workflow) {
      throw new AppError('NOT_FOUND', 'Workflow execution not found.');
    }

    return toWorkflowDto(await this.reconcileWorkflow(userId, workflow));
  }

  async getPublicWorkflowStatus(userId: string, workflowExecutionId: string): Promise<PublicWorkflowExecutionDto> {
    return toPublicWorkflowExecutionDto(await this.getWorkflowStatus(userId, workflowExecutionId));
  }

  private async reconcileWorkflow(userId: string, workflow: WorkflowExecution): Promise<WorkflowExecution> {
    if (workflow.externalExecutionId && isActiveWorkflowStatus(workflow.status)) {
      try {
        const execution = await this.executionService.pollExecution(workflow.externalExecutionId);
        const nextStatus = mapN8nStatusToWorkflowStatus(execution.status);
        const nextStartedAt = execution.startedAt ? new Date(execution.startedAt) : workflow.startedAt;
        const nextCompletedAt = execution.stoppedAt ? new Date(execution.stoppedAt) : workflow.completedAt;
        const nextErrorMessage = nextStatus === WorkflowStatus.ERROR ? execution.rawStatus ?? 'Workflow failed.' : null;
        const nextResponsePayload = (execution.data === null ? workflow.responsePayload : execution.data) as Prisma.JsonValue | null;
        const nextMetadata = (hasPollFailureMarker(workflow.metadata)
          ? clearPollFailureMetadata(workflow.metadata)
          : workflow.metadata) as Prisma.JsonValue | null;
        const workflowChanged = hasWorkflowStateChanged(workflow, {
          status: nextStatus,
          startedAt: nextStartedAt,
          completedAt: nextCompletedAt,
          errorMessage: nextErrorMessage,
          responsePayload: nextResponsePayload,
          metadata: nextMetadata,
        });

        if (!workflowChanged && !isReconciliationRequired(workflow.metadata)) {
          return workflow;
        }

        const data: Prisma.WorkflowExecutionUpdateInput = {
          status: nextStatus,
          startedAt: nextStartedAt,
          completedAt: nextCompletedAt,
          errorMessage: nextErrorMessage,
          ...(execution.data === null ? {} : { responsePayload: execution.data }),
          ...(hasPollFailureMarker(workflow.metadata) ? { metadata: clearPollFailureMetadata(workflow.metadata) } : {}),
        };
        const shouldSync = await this.shouldSyncResourceStatuses(userId, {
          ...workflow,
          status: nextStatus,
          startedAt: nextStartedAt,
          completedAt: nextCompletedAt,
          errorMessage: nextErrorMessage,
          responsePayload: nextResponsePayload,
          metadata: nextMetadata,
        });

        return this.runInTransaction(async (transaction) => {
          const updatedWorkflow = await transaction.workflowExecution.update({
            where: { id: workflow.id },
            data,
          });
          const syncResult = shouldSync
            ? await this.syncResourceStatuses(transaction, userId, updatedWorkflow)
            : { uploadUpdated: false, documentUpdated: false };

          await this.recordWorkflowReconciliationAudit(transaction, userId, updatedWorkflow, syncResult, true);

          return updatedWorkflow;
        });
      } catch {
        return this.persistRecoverablePollFailure(workflow);
      }
    }

    if (isReconciliationRequired(workflow.metadata)) {
      if (await this.shouldSyncResourceStatuses(userId, workflow)) {
        await this.runInTransaction(async (transaction) => {
          const syncResult = await this.syncResourceStatuses(transaction, userId, workflow);
          await this.recordWorkflowReconciliationAudit(transaction, userId, workflow, syncResult, false);
        });
      }
    }

    return workflow;
  }

  private async persistRecoverablePollFailure(workflow: WorkflowExecution): Promise<WorkflowExecution> {
    const metadata = buildPollFailureMetadata(workflow.metadata, new Date().toISOString());

    try {
      return await this.runInTransaction(async (transaction) => {
        const updatedWorkflow = await transaction.workflowExecution.update({
          where: { id: workflow.id },
          data: {
            metadata,
          },
        });

        if (typeof transaction.auditLog?.create === 'function') {
          await transaction.auditLog.create({
            data: {
              userId: workflow.userId,
              action: WORKFLOW_RECONCILIATION_ISSUE_ACTION,
              entityType: 'workflow_execution',
              entityId: workflow.id,
              metadata: {
                workflowKey: workflow.workflowKey,
                workflowStatus: workflow.status,
                reconciliationIssue: RECONCILIATION_ISSUE_UPSTREAM_UNAVAILABLE,
                reconciliationSource: RECONCILIATION_SOURCE_N8N_POLL,
                reconciliationRequired: true,
                ...(workflow.uploadId ? { uploadId: workflow.uploadId } : {}),
                ...(workflow.documentId ? { documentId: workflow.documentId } : {}),
              },
            },
          });
        }

        return updatedWorkflow;
      });
    } catch {
      return {
        ...workflow,
        metadata: metadata as unknown as Prisma.JsonValue,
      };
    }
  }

  private async shouldSyncResourceStatuses(userId: string, workflow: WorkflowExecution): Promise<boolean> {
    if (!workflow.documentId && !workflow.uploadId) {
      return true;
    }

    const latestWorkflow = await this.db.workflowExecution.findFirst({
      where: {
        userId,
        workflowKey: workflow.workflowKey,
        ...(workflow.documentId ? { documentId: workflow.documentId } : { uploadId: workflow.uploadId }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return !latestWorkflow || latestWorkflow.id === workflow.id;
  }

  private async runInTransaction<T>(callback: (transaction: WorkflowTransactionDb) => Promise<T>): Promise<T> {
    const transactionRunner = this.transactionRunner;

    if (typeof transactionRunner.$transaction === 'function') {
      return transactionRunner.$transaction(async (transaction) => callback(transaction as WorkflowTransactionDb));
    }

    return callback(transactionRunner as unknown as WorkflowTransactionDb);
  }

  private async recordWorkflowReconciliationAudit(
    transaction: WorkflowTransactionDb,
    userId: string,
    workflow: WorkflowExecution,
    syncResult: ResourceSyncResult,
    workflowUpdated: boolean,
  ): Promise<void> {
    if (!workflowUpdated && !syncResult.uploadStatus && !syncResult.documentStatus) {
      return;
    }

    if (typeof transaction.auditLog?.create !== 'function') {
      return;
    }

    await transaction.auditLog.create({
      data: {
        userId,
        action: WORKFLOW_RECONCILED_ACTION,
        entityType: 'workflow_execution',
        entityId: workflow.id,
        metadata: {
          workflowKey: workflow.workflowKey,
          workflowStatus: workflow.status,
          ...(workflow.uploadId ? { uploadId: workflow.uploadId } : {}),
          ...(syncResult.uploadStatus ? { uploadStatus: syncResult.uploadStatus } : {}),
          uploadUpdated: syncResult.uploadUpdated,
          ...(workflow.documentId ? { documentId: workflow.documentId } : {}),
          ...(syncResult.documentStatus ? { documentStatus: syncResult.documentStatus } : {}),
          documentUpdated: syncResult.documentUpdated,
          reconciliationRequired: isReconciliationRequired(workflow.metadata),
        },
      },
    });
  }

  private async syncResourceStatuses(
    transaction: WorkflowTransactionDb,
    userId: string,
    workflow: WorkflowExecution,
  ): Promise<ResourceSyncResult> {
    const reindexWorkflow = isReindexWorkflow(workflow.metadata);
    const result: ResourceSyncResult = {
      uploadUpdated: false,
      documentUpdated: false,
    };

    if (workflow.uploadId && !reindexWorkflow) {
      const uploadStatus = mapWorkflowStatusToUploadStatus(workflow.status);
      const uploadUpdateResult = await transaction.upload.updateMany({
        where: { id: workflow.uploadId, userId, status: { not: uploadStatus } },
        data: {
          status: uploadStatus,
        },
      });

      result.uploadStatus = uploadStatus;
      result.uploadUpdated = (uploadUpdateResult?.count ?? 0) > 0;
    }

    if (workflow.documentId) {
      if (reindexWorkflow) {
        if (workflow.status === WorkflowStatus.SUCCESS) {
          const documentUpdateResult = await transaction.document.updateMany({
            where: {
              id: workflow.documentId,
              userId,
              status: {
                notIn: [DocumentStatus.READY, DocumentStatus.DELETED],
              },
            },
            data: {
              status: DocumentStatus.READY,
            },
          });

          result.documentStatus = DocumentStatus.READY;
          result.documentUpdated = (documentUpdateResult?.count ?? 0) > 0;
        }

        return result;
      }

      const documentStatus = mapWorkflowStatusToDocumentStatus(workflow.status);
      const documentUpdateResult = await transaction.document.updateMany({
        where: {
          id: workflow.documentId,
          userId,
          status: {
            notIn: [documentStatus, DocumentStatus.DELETED],
          },
        },
        data: {
          status: documentStatus,
        },
      });

      result.documentStatus = documentStatus;
      result.documentUpdated = (documentUpdateResult?.count ?? 0) > 0;
    }

    return result;
  }
}
