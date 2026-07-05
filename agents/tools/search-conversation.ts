import 'server-only';

import { tool } from '@openai/agents';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';

import { buildSnippet, getAgentToolContext, type AgentToolRuntimeContext, withRecordedToolCall } from '@/agents/tools/shared';

const searchConversationInputSchema = z.object({
  query: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).optional(),
  limit: z.number().int().positive().max(50).default(10),
});

export function createSearchConversationTool(
  dependencies: {
    db?: Pick<typeof prisma, 'toolCall' | 'conversation' | 'message'>;
  } = {},
) {
  const db = dependencies.db ?? prisma;

  return tool<typeof searchConversationInputSchema, AgentToolRuntimeContext>({
    name: 'search_conversation',
    description: 'Search message history for the current user and return matching snippets.',
    parameters: searchConversationInputSchema,
    execute: async (input, runContext) => {
      const context = getAgentToolContext(runContext);

      return withRecordedToolCall({
        db,
        agentRunId: context.agentRunId,
        toolName: 'search_conversation',
        args: input,
        metadata: {
          requestId: context.requestId,
        },
        execute: async () => {
          if (input.conversationId) {
            const conversation = await db.conversation.findFirst({
              where: {
                id: input.conversationId,
                userId: context.userId,
                deletedAt: null,
              },
              select: { id: true },
            });

            if (!conversation) {
              throw new AppError('NOT_FOUND', 'Conversation not found.');
            }
          }

          const messages = await db.message.findMany({
            where: {
              conversation: {
                userId: context.userId,
                deletedAt: null,
              },
              ...(input.conversationId ? { conversationId: input.conversationId } : {}),
              content: {
                contains: input.query,
                mode: 'insensitive',
              },
            },
            orderBy: { createdAt: 'desc' },
            take: input.limit,
            select: {
              id: true,
              role: true,
              content: true,
              citations: true,
              createdAt: true,
              conversation: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
          });

          return {
            results: messages.map((message) => ({
              conversationId: message.conversation.id,
              conversationTitle: message.conversation.title,
              messageId: message.id,
              role: message.role,
              snippet: buildSnippet(message.content),
              createdAt: message.createdAt.toISOString(),
              citations: message.citations,
            })),
          };
        },
      });
    },
  });
}
