import 'server-only';

import { tool } from '@openai/agents';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';

import { getAgentToolContext, type AgentToolRuntimeContext, withRecordedToolCall } from '@/agents/tools/shared';

const conversationHistoryInputSchema = z.object({
  conversationId: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(50).default(10),
});

export function createConversationHistoryTool(
  dependencies: {
    db?: Pick<typeof prisma, 'toolCall' | 'conversation' | 'message'>;
  } = {},
) {
  const db = dependencies.db ?? prisma;

  return tool<typeof conversationHistoryInputSchema, AgentToolRuntimeContext>({
    name: 'conversation_history',
    description: 'Retrieve recent messages from the current conversation or another owned conversation.',
    parameters: conversationHistoryInputSchema,
    execute: async (input, runContext) => {
      const context = getAgentToolContext(runContext);
      const targetConversationId = input.conversationId ?? context.conversationId;

      return withRecordedToolCall({
        db,
        agentRunId: context.agentRunId,
        toolName: 'conversation_history',
        args: {
          ...input,
          conversationId: targetConversationId,
        },
        metadata: {
          requestId: context.requestId,
        },
        execute: async () => {
          const conversation = await db.conversation.findFirst({
            where: {
              id: targetConversationId,
              userId: context.userId,
              deletedAt: null,
            },
            select: {
              id: true,
              title: true,
              status: true,
            },
          });

          if (!conversation) {
            throw new AppError('NOT_FOUND', 'Conversation not found.');
          }

          const messages = await db.message.findMany({
            where: {
              conversationId: targetConversationId,
            },
            orderBy: { createdAt: 'desc' },
            take: input.limit,
          });

          return {
            conversation,
            messages: messages.reverse().map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              createdAt: message.createdAt.toISOString(),
              citations: message.citations,
              toolCalls: message.toolCalls,
            })),
          };
        },
      });
    },
  });
}
