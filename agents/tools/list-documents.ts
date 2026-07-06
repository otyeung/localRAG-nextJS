import 'server-only';

import { DocumentStatus } from '@prisma/client';
import { tool } from '@openai/agents';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';
import { DocumentService } from '@/lib/services/document-service';

import {
  getAgentToolContext,
  type AgentToolRuntimeContext,
  withRecordedToolCall,
} from '@/agents/tools/shared';

const documentStatuses = new Set<string>(Object.keys(DocumentStatus));

function toOptionalTrimmed(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
}

function toDocumentStatus(
  value: unknown,
): keyof typeof DocumentStatus | undefined {
  const normalized = toOptionalTrimmed(value);
  return normalized && documentStatuses.has(normalized)
    ? (normalized as keyof typeof DocumentStatus)
    : undefined;
}

function toLimit(value: unknown, defaultValue: number, max: number): number {
  const parsed =
    typeof value === 'number'
      ? value
      : Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, max)
    : defaultValue;
}

const listDocumentsInputSchema = z.object({
  query: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  limit: z
    .union([z.string(), z.number(), z.boolean()])
    .nullable()
    .default(null),
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
    description:
      "List the current user's uploaded documents and their ready/ingesting status.",
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
          const query = toOptionalTrimmed(input.query);
          const status = toDocumentStatus(input.status);
          const limit = toLimit(input.limit, 10, 50);
          const result = await documentService.listDocuments(context.userId, {
            search: query,
            status,
            page: 1,
            pageSize: limit,
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
