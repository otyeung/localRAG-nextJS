import { ToolCallStatus } from '@prisma/client';
import type { RunContext } from '@openai/agents';

import { AppError } from '@/lib/http/api-errors';
import { logger } from '@/lib/logger/logger';

export type AgentToolRuntimeContext = {
  userId: string;
  conversationId: string;
  agentRunId: string;
  requestId?: string;
};

export type ToolCallPersistence = {
  toolCall: {
    create: (...args: any[]) => Promise<any>;
    update: (...args: any[]) => Promise<any>;
  };
};

export function getAgentToolContext(runContext?: RunContext<unknown>): AgentToolRuntimeContext {
  const context = runContext?.context as Partial<AgentToolRuntimeContext> | undefined;

  if (
    !context ||
    typeof context.userId !== 'string' ||
    typeof context.conversationId !== 'string' ||
    typeof context.agentRunId !== 'string'
  ) {
    throw new AppError('INTERNAL_ERROR', 'Agent tool context is unavailable.');
  }

  return context as AgentToolRuntimeContext;
}

export async function withRecordedToolCall<TArgs, TResult>(options: {
  db: ToolCallPersistence;
  agentRunId: string;
  toolName: string;
  args: TArgs;
  metadata?: Record<string, unknown>;
  execute: () => Promise<TResult>;
}): Promise<TResult> {
  const startedAt = Date.now();
  const createdToolCall = (await options.db.toolCall.create({
    data: {
      agentRunId: options.agentRunId,
      name: options.toolName,
      status: ToolCallStatus.STARTED,
      arguments: options.args,
      metadata: options.metadata,
    },
  })) as { id?: string };
  const toolCallId = createdToolCall.id;

  if (!toolCallId) {
    throw new AppError('INTERNAL_ERROR', 'Tool call persistence did not return an identifier.');
  }

  try {
    const result = await options.execute();
    await options.db.toolCall.update({
      where: { id: toolCallId },
      data: {
        status: ToolCallStatus.COMPLETED,
        result,
        errorMessage: null,
        completedAt: new Date(),
        metadata: {
          ...(options.metadata ?? {}),
          durationMs: Date.now() - startedAt,
        },
      },
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unexpected tool error occurred.';
    logger.warn(
      {
        err: error,
        toolName: options.toolName,
        agentRunId: options.agentRunId,
      },
      'Agent tool execution failed.',
    );
    await options.db.toolCall.update({
      where: { id: toolCallId },
      data: {
        status: ToolCallStatus.FAILED,
        errorMessage,
        completedAt: new Date(),
        metadata: {
          ...(options.metadata ?? {}),
          durationMs: Date.now() - startedAt,
        },
      },
    });
    throw error;
  }
}

export function buildSnippet(value: string, maxLength = 200): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
