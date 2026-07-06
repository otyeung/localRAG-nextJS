import { RunContext } from '@openai/agents';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));
vi.mock('@/lib/logger/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createRetrieveChunksTool } from '@/agents/tools/retrieve-chunks';
import { createSearchConversationTool } from '@/agents/tools/search-conversation';
import { createListDocumentsTool } from '@/agents/tools/list-documents';

describe('agent tools', () => {
  const toolCallCreate = vi.fn();
  const toolCallUpdate = vi.fn();
  const documentFindMany = vi.fn();
  const retrievalService = {
    retrieve: vi.fn(),
  };
  const conversationFindFirst = vi.fn();
  const messageFindMany = vi.fn();
  const listDocuments = vi.fn();

  beforeEach(() => {
    toolCallCreate.mockReset();
    toolCallUpdate.mockReset();
    documentFindMany.mockReset();
    retrievalService.retrieve.mockReset();
    conversationFindFirst.mockReset();
    messageFindMany.mockReset();
    listDocuments.mockReset();

    toolCallCreate.mockResolvedValue({ id: 'tool_call_1' });
    toolCallUpdate.mockResolvedValue(undefined);
  });

  it('records successful retrieval tool calls and returns serializable chunk data', async () => {
    documentFindMany.mockResolvedValue([
      {
        id: 'document_1',
      },
    ]);
    retrievalService.retrieve.mockResolvedValue([
      {
        id: 'chunk_1',
        documentId: 'document_1',
        documentName: 'Cymbal Starlight Manual',
        chunkIndex: 0,
        content: 'Cargo capacity: 4,500 metric tons.',
        score: 0.98,
        metadata: {
          page: 4,
        },
      },
    ]);

    const tool = createRetrieveChunksTool({
      db: {
        toolCall: {
          create: toolCallCreate,
          update: toolCallUpdate,
        },
        document: {
          findMany: documentFindMany,
        },
      } as never,
      retrievalService: retrievalService as never,
    });

    const result = await tool.invoke(
      new RunContext({
        userId: 'user_1',
        conversationId: 'conversation_1',
        agentRunId: 'run_1',
        requestId: 'req_1',
      }),
      JSON.stringify({
        query: 'cargo capacity',
        documentIds: ['document_1'],
        topK: 3,
      }),
    );

    expect(result).toEqual({
      chunks: [
        {
          id: 'chunk_1',
          documentId: 'document_1',
          documentName: 'Cymbal Starlight Manual',
          chunkIndex: 0,
          content: 'Cargo capacity: 4,500 metric tons.',
          score: 0.98,
        },
      ],
    });
    expect(toolCallCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agentRunId: 'run_1',
        name: 'retrieve_chunks',
        status: 'STARTED',
        arguments: {
          query: 'cargo capacity',
          documentIds: ['document_1'],
          topK: 3,
        },
      }),
    });
    expect(toolCallUpdate).toHaveBeenCalledWith({
      where: { id: 'tool_call_1' },
      data: expect.objectContaining({
        status: 'COMPLETED',
        result: {
          chunks: [
            {
              id: 'chunk_1',
              documentId: 'document_1',
              documentName: 'Cymbal Starlight Manual',
              chunkIndex: 0,
              content: 'Cargo capacity: 4,500 metric tons.',
              score: 0.98,
            },
          ],
        },
        errorMessage: null,
        completedAt: expect.any(Date),
        metadata: expect.objectContaining({
          durationMs: expect.any(Number),
        }),
      }),
    });
  });

  it('coerces empty optional strings from local models when listing documents', async () => {
    listDocuments.mockResolvedValue({
      items: [
        {
          id: 'document_1',
          title: 'Cymbal Starlight',
          status: 'READY',
          originalFilename: 'cymbal-starlight-2024.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 336748,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    const tool = createListDocumentsTool({
      db: {
        toolCall: {
          create: toolCallCreate,
          update: toolCallUpdate,
        },
      } as never,
      documentService: {
        listDocuments,
      },
    });

    const result = await tool.invoke(
      new RunContext({
        userId: 'user_1',
        conversationId: 'conversation_1',
        agentRunId: 'run_1',
        requestId: 'req_1',
      }),
      JSON.stringify({
        query: 'Cymbal Starlight cargo capacity',
        status: null,
        limit: false,
      }),
    );

    expect(result).toEqual({
      documents: [
        {
          id: 'document_1',
          title: 'Cymbal Starlight',
          status: 'READY',
          originalFilename: 'cymbal-starlight-2024.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 336748,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });
    expect(listDocuments).toHaveBeenCalledWith('user_1', {
      search: 'Cymbal Starlight cargo capacity',
      status: undefined,
      page: 1,
      pageSize: 10,
      sort: 'updatedAt',
      order: 'desc',
    });
  });

  it('rejects retrieve_chunks documentIds that are not owned by the current user', async () => {
    documentFindMany.mockResolvedValue([
      {
        id: 'document_1',
      },
    ]);

    const tool = createRetrieveChunksTool({
      db: {
        toolCall: {
          create: toolCallCreate,
          update: toolCallUpdate,
        },
        document: {
          findMany: documentFindMany,
        },
      } as never,
      retrievalService: retrievalService as never,
    });

    await expect(
      tool.invoke(
        new RunContext({
          userId: 'user_1',
          conversationId: 'conversation_1',
          agentRunId: 'run_1',
          requestId: 'req_1',
        }),
        JSON.stringify({
          query: 'cargo capacity',
          documentIds: ['document_1', 'document_2'],
          topK: 3,
        }),
      ),
    ).resolves.toContain('One or more requested documents are unavailable.');

    expect(documentFindMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: ['document_1', 'document_2'],
        },
        userId: 'user_1',
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    expect(retrievalService.retrieve).not.toHaveBeenCalled();
    expect(toolCallUpdate).toHaveBeenCalledWith({
      where: { id: 'tool_call_1' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'One or more requested documents are unavailable.',
      }),
    });
  });

  it('records failed search tool calls and returns the default tool error message', async () => {
    conversationFindFirst.mockResolvedValue(null);
    const tool = createSearchConversationTool({
      db: {
        toolCall: {
          create: toolCallCreate,
          update: toolCallUpdate,
        },
        conversation: {
          findFirst: conversationFindFirst,
        },
        message: {
          findMany: messageFindMany,
        },
      } as never,
    });

    await expect(
      tool.invoke(
        new RunContext({
          userId: 'user_1',
          conversationId: 'conversation_1',
          agentRunId: 'run_1',
          requestId: 'req_1',
        }),
        JSON.stringify({
          query: 'cargo',
          conversationId: 'conversation_missing',
        }),
      ),
    ).resolves.toContain('Conversation not found.');

    expect(toolCallUpdate).toHaveBeenCalledWith({
      where: { id: 'tool_call_1' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: 'Conversation not found.',
        completedAt: expect.any(Date),
        metadata: expect.objectContaining({
          durationMs: expect.any(Number),
        }),
      }),
    });
  });
});
