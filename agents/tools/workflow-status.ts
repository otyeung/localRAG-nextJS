import 'server-only';

import { tool } from '@openai/agents';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';

import { getAgentToolContext, type AgentToolRuntimeContext, withRecordedToolCall } from '@/agents/tools/shared';

const workflowStatusInputSchema = z.object({
  workflowExecutionId: z.string().trim().min(1).optional(),
  documentId: z.string().trim().min(1).optional(),
  uploadId: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(20).default(10),
});

export function createWorkflowStatusTool(
  dependencies: {
    db?: Pick<typeof prisma, 'toolCall' | 'workflowExecution'>;
  } = {},
) {
  const db = dependencies.db ?? prisma;

  return tool<typeof workflowStatusInputSchema, AgentToolRuntimeContext>({
    name: 'workflow_status',
    description: 'Check public workflow execution status for the current user.',
    parameters: workflowStatusInputSchema,
    execute: async (input, runContext) => {
      const context = getAgentToolContext(runContext);

      return withRecordedToolCall({
        db,
        agentRunId: context.agentRunId,
        toolName: 'workflow_status',
        args: input,
        metadata: {
          requestId: context.requestId,
        },
        execute: async () => {
          const workflows = await db.workflowExecution.findMany({
            where: {
              userId: context.userId,
              ...(input.workflowExecutionId ? { id: input.workflowExecutionId } : {}),
              ...(input.documentId ? { documentId: input.documentId } : {}),
              ...(input.uploadId ? { uploadId: input.uploadId } : {}),
            },
            orderBy: { updatedAt: 'desc' },
            take: input.limit,
          });

          return {
            workflows: workflows.map((workflow) => ({
              id: workflow.id,
              workflowKey: workflow.workflowKey,
              status: workflow.status,
              errorMessage: workflow.errorMessage,
              createdAt: workflow.createdAt.toISOString(),
              updatedAt: workflow.updatedAt.toISOString(),
              startedAt: workflow.startedAt?.toISOString() ?? null,
              completedAt: workflow.completedAt?.toISOString() ?? null,
              uploadId: workflow.uploadId,
              documentId: workflow.documentId,
            })),
          };
        },
      });
    },
  });
}
