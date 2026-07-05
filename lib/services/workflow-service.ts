import 'server-only';

import { DocumentStatus, UploadStatus, WorkflowStatus, type WorkflowExecution } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nExecutionService } from '@/lib/n8n/executions';

type WorkflowDb = Pick<
  typeof prisma,
  'workflowExecution' | 'upload' | 'document'
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

export type WorkflowListResult = {
  items: WorkflowExecutionDto[];
  total: number;
};

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

  async listWorkflows(userId: string): Promise<WorkflowListResult> {
    const [items, total] = await Promise.all([
      this.db.workflowExecution.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.workflowExecution.count({
        where: { userId },
      }),
    ]);

    return {
      items: items.map(toWorkflowDto),
      total,
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

    if (
      workflow.externalExecutionId &&
      (workflow.status === WorkflowStatus.RUNNING ||
        workflow.status === WorkflowStatus.WAITING ||
        workflow.status === WorkflowStatus.QUEUED)
    ) {
      const execution = await this.executionService.pollExecution(workflow.externalExecutionId);
      const nextStatus = mapN8nStatusToWorkflowStatus(execution.status);

      const updated = await this.db.workflowExecution.update({
        where: { id: workflow.id },
        data: {
          status: nextStatus,
          startedAt: execution.startedAt ? new Date(execution.startedAt) : workflow.startedAt,
          completedAt: execution.stoppedAt ? new Date(execution.stoppedAt) : workflow.completedAt,
          errorMessage: nextStatus === WorkflowStatus.ERROR ? execution.rawStatus ?? 'Workflow failed.' : null,
          ...(execution.data === null ? {} : { responsePayload: execution.data }),
        },
      });

      await this.syncResourceStatuses(userId, updated);
      return toWorkflowDto(updated);
    }

    return toWorkflowDto(workflow);
  }

  private async syncResourceStatuses(userId: string, workflow: WorkflowExecution): Promise<void> {
    if (workflow.uploadId) {
      await this.db.upload.updateMany({
        where: { id: workflow.uploadId, userId },
        data: {
          status:
            workflow.status === WorkflowStatus.SUCCESS
              ? UploadStatus.COMPLETED
              : workflow.status === WorkflowStatus.CANCELED
                ? UploadStatus.CANCELED
                : workflow.status === WorkflowStatus.ERROR
                  ? UploadStatus.FAILED
                  : UploadStatus.INGESTING,
        },
      });
    }

    if (workflow.documentId) {
      await this.db.document.updateMany({
        where: { id: workflow.documentId, userId },
        data: {
          status:
            workflow.status === WorkflowStatus.SUCCESS
              ? DocumentStatus.READY
              : workflow.status === WorkflowStatus.ERROR || workflow.status === WorkflowStatus.CANCELED
                ? DocumentStatus.FAILED
                : DocumentStatus.INGESTING,
        },
      });
    }
  }
}
