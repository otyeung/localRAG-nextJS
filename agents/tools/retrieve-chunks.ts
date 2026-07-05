import 'server-only';

import { tool } from '@openai/agents';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { N8nRetrievalService } from '@/lib/n8n/retrieval';

import { getAgentToolContext, type AgentToolRuntimeContext, withRecordedToolCall } from '@/agents/tools/shared';

const retrieveChunksInputSchema = z.object({
  query: z.string().trim().min(1),
  documentIds: z.array(z.string().trim().min(1)).default([]),
  topK: z.number().int().positive().max(20).default(5),
});

export type RetrieveChunksToolResult = {
  chunks: Array<{
    id: string;
    documentId: string;
    documentName: string;
    chunkIndex: number;
    content: string;
    score: number;
  }>;
};

export function createRetrieveChunksTool(
  dependencies: {
    db?: Pick<typeof prisma, 'toolCall' | 'document'>;
    retrievalService?: Pick<N8nRetrievalService, 'retrieve'>;
  } = {},
) {
  const db = dependencies.db ?? prisma;
  const retrievalService = dependencies.retrievalService ?? new N8nRetrievalService();

  return tool<typeof retrieveChunksInputSchema, AgentToolRuntimeContext, RetrieveChunksToolResult>({
    name: 'retrieve_chunks',
    description: 'Retrieve document chunks relevant to the user query before answering document-grounded questions.',
    parameters: retrieveChunksInputSchema,
    execute: async (input, runContext) => {
      const context = getAgentToolContext(runContext);

      return withRecordedToolCall({
        db,
        agentRunId: context.agentRunId,
        toolName: 'retrieve_chunks',
        args: input,
        metadata: {
          conversationId: context.conversationId,
          requestId: context.requestId,
        },
        execute: async (): Promise<RetrieveChunksToolResult> => {
          if (input.documentIds.length > 0) {
            const requestedDocumentIds = [...new Set(input.documentIds)];
            const ownedDocuments = await db.document.findMany({
              where: {
                id: {
                  in: requestedDocumentIds,
                },
                userId: context.userId,
                deletedAt: null,
              },
              select: {
                id: true,
              },
            });

            if (ownedDocuments.length !== requestedDocumentIds.length) {
              throw new AppError('BAD_REQUEST', 'One or more requested documents are unavailable.');
            }
          }

          const chunks = await retrievalService.retrieve({
            query: input.query,
            conversationId: context.conversationId,
            documentIds: input.documentIds,
            topK: input.topK,
            requestId: context.requestId,
          });

          return {
            chunks: chunks.map((chunk) => ({
              id: chunk.id,
              documentId: chunk.documentId,
              documentName: chunk.documentName,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              score: chunk.score,
            })),
          };
        },
      });
    },
  });
}
