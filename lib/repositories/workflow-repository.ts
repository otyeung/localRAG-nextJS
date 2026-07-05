import { WorkflowExecution, WorkflowStatus } from '@prisma/client';

import type { CreateWorkflowExecutionInput, DbClient } from '@/lib/repositories/types';

export class WorkflowRepository {
  constructor(private readonly db: DbClient) {}

  async createExecution(input: CreateWorkflowExecutionInput): Promise<WorkflowExecution> {
    return this.db.workflowExecution.create({
      data: {
        userId: input.userId,
        documentId: input.documentId,
        uploadId: input.uploadId,
        workflowKey: input.workflowKey,
        status: WorkflowStatus.QUEUED,
        externalExecutionId: input.externalExecutionId,
        requestPayload: input.requestPayload,
        responsePayload: input.responsePayload,
        metadata: input.metadata,
        errorMessage: input.errorMessage,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      },
    });
  }
}
