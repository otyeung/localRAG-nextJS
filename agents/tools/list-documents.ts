import 'server-only';

import { DocumentStatus } from '@prisma/client';
import { tool } from '@openai/agents';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';
import { DocumentService } from '@/lib/services/document-service';

import { getAgentToolContext, type AgentToolRuntimeContext, withRecordedToolCall } from '@/agents/tools/shared';

const listDocumentsInputSchema = z.object({
  query: z.string().trim().min(1).optional(),
  status: z.enum(Object.keys(DocumentStatus) as [keyof typeof DocumentStatus, ...Array<keyof typeof DocumentStatus>]).optional(),
  limit: z.number().int().positive().max(50).default(10),
});

export function createListDocumentsTool(
  dependencies: {
    db?: Pick<typeof prisma, 'toolCall'>;
    documentService?: Pick<DocumentService, 'listDocuments'>;
  } = {},
) {
  const db = dependencies.db ?? prisma;
  const documentService = dependencies.documentService ?? new DocumentService();

  return tool<typeof listDocumentsInputSchema, AgentToolRuntimeContext>({
    name: 'list_documents',
    description: "List the current user's uploaded documents and their ready/ingesting status.",
    parameters: listDocumentsInputSchema,
    execute: async (input, runContext) => {
      const context = getAgentToolContext(runContext);

      return withRecordedToolCall({
        db,
        agentRunId: context.agentRunId,
        toolName: 'list_documents',
        args: input,
        metadata: {
          requestId: context.requestId,
        },
        execute: async () => {
          const result = await documentService.listDocuments(context.userId, {
            search: input.query,
            status: input.status,
            page: 1,
            pageSize: input.limit,
            sort: 'updatedAt',
            order: 'desc',
          });

          return {
            documents: result.items.map((document) => ({
              id: document.id,
              title: document.title,
              status: document.status,
              originalFilename: document.originalFilename,
              mimeType: document.mimeType,
              fileSizeBytes: document.fileSizeBytes,
              createdAt: document.createdAt,
              updatedAt: document.updatedAt,
            })),
            total: result.total,
          };
        },
      });
    },
  });
}
