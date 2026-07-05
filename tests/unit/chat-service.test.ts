import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/agents/registry', () => {
  const clone = vi.fn(function clone(this: { name: string; model: string }, overrides?: { model?: string }) {
    return {
      ...this,
      model: overrides?.model ?? this.model,
      clone,
    };
  });
  const agent = {
    name: 'GeneralAssistantAgent',
    model: 'test-model',
    clone,
  };

  return {
    agentRegistry: new Map([['GeneralAssistantAgent', agent]]),
    defaultAgentName: 'GeneralAssistantAgent',
  };
});
vi.mock('@/lib/config/env', () => ({
  env: {
    openai: {
      model: 'fallback-model',
    },
    logger: {
      level: 'silent',
    },
  },
}));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {},
}));

import { ChatService } from '@/lib/services/chat-service';

describe('ChatService', () => {
  const conversationFindFirst = vi.fn();
  const conversationCreate = vi.fn();
  const conversationUpdate = vi.fn();
  const messageCreate = vi.fn();
  const agentRunCreate = vi.fn();
  const agentRunUpdate = vi.fn();
  const auditLogCreate = vi.fn();
  const toolCallFindMany = vi.fn();
  const runAgent = vi.fn();
  const streamResponseFactory = vi.fn();
  const db = {
    $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        conversation: {
          create: conversationCreate,
          findFirst: conversationFindFirst,
          update: conversationUpdate,
        },
        message: {
          create: messageCreate,
        },
        agentRun: {
          create: agentRunCreate,
          update: agentRunUpdate,
        },
        toolCall: {
          findMany: toolCallFindMany,
        },
        auditLog: {
          create: auditLogCreate,
        },
      }),
    ),
    conversation: {
      findFirst: conversationFindFirst,
      update: conversationUpdate,
    },
    message: {
      create: messageCreate,
    },
    agentRun: {
      create: agentRunCreate,
      update: agentRunUpdate,
    },
    toolCall: {},
    auditLog: {
      create: auditLogCreate,
    },
  };

  beforeEach(() => {
    conversationFindFirst.mockReset();
    conversationCreate.mockReset();
    conversationUpdate.mockReset();
    messageCreate.mockReset();
    agentRunCreate.mockReset();
    agentRunUpdate.mockReset();
    auditLogCreate.mockReset();
    toolCallFindMany.mockReset();
    runAgent.mockReset();
    streamResponseFactory.mockReset();
    db.$transaction.mockClear();

    conversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      userId: 'user_1',
      title: 'Existing Chat',
      status: 'ACTIVE',
      searchText: null,
      deletedAt: null,
    });
    messageCreate.mockResolvedValue({
      id: 'message_1',
    });
    agentRunCreate.mockResolvedValue({
      id: 'agent_run_1',
    });
    toolCallFindMany.mockResolvedValue([]);
    runAgent.mockResolvedValue({
      completed: new Promise(() => {}),
      finalOutput: '',
      activeAgent: { name: 'GeneralAssistantAgent' },
      lastResponseId: 'response_1',
    });
    streamResponseFactory.mockReturnValue(
      Response.json({
        streamed: true,
      }),
    );
  });

  it('uses legacy content fallback for latest user persistence and records safe audit logs', async () => {
    const service = new ChatService({
      db: db as never,
      settingsService: {
        getForUser: vi.fn().mockResolvedValue({
          model: 'test-model',
        }),
      },
      runAgent,
      streamResponseFactory,
    });

    const response = await service.streamChat({
      userId: 'user_1',
      requestId: 'req_chat_service',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      conversationId: 'conversation_1',
      messages: [
        {
          role: 'user',
          parts: [],
          content: 'Use the older content field',
        },
      ] as never,
    });

    expect(response.status).toBe(200);
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conversation_1',
          content: 'Use the older content field',
        }),
      }),
    );
    expect(agentRunCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conversation_1',
          status: 'RUNNING',
        }),
      }),
    );
    const auditActions = auditLogCreate.mock.calls.map(([input]) => input.data.action);
    expect(auditActions).toEqual(['message.created', 'agent_run.created']);
    const auditMetadata = auditLogCreate.mock.calls.map(([input]) => input.data.metadata);
    expect(auditMetadata).toEqual([
      expect.objectContaining({
        source: 'chat-api',
        conversationId: 'conversation_1',
        role: 'USER',
      }),
      expect.objectContaining({
        source: 'chat-api',
        conversationId: 'conversation_1',
        activeAgentName: 'GeneralAssistantAgent',
      }),
    ]);
    expect(auditMetadata[0]).not.toHaveProperty('content');
    expect(auditMetadata[1]).not.toHaveProperty('assistantText');
  });

  it('persists safe citations derived from retrieve_chunks tool results', async () => {
    messageCreate
      .mockResolvedValueOnce({
        id: 'message_user_1',
      })
      .mockResolvedValueOnce({
        id: 'message_assistant_1',
      });
    toolCallFindMany.mockResolvedValue([
      {
        id: 'tool_call_1',
        name: 'retrieve_chunks',
        result: {
          chunks: [
            {
              id: 'chunk_1',
              documentId: 'document_1',
              documentName: 'Cymbal Starlight Manual',
              chunkIndex: 7,
              content: 'Cargo capacity: 4,500 metric tons with balanced load distribution.',
              score: 0.98,
              metadata: {
                internalOnly: 'do-not-persist',
              },
            },
          ],
          rawPayload: {
            internal: true,
          },
        },
      },
    ]);
    runAgent.mockResolvedValue({
      completed: Promise.resolve(),
      finalOutput: 'The Cymbal Starlight can carry 4,500 metric tons.',
      activeAgent: { name: 'GeneralAssistantAgent' },
      lastResponseId: 'response_1',
    });

    const service = new ChatService({
      db: db as never,
      settingsService: {
        getForUser: vi.fn().mockResolvedValue({
          model: 'test-model',
        }),
      },
      runAgent,
      streamResponseFactory,
    });

    const response = await service.streamChat({
      userId: 'user_1',
      requestId: 'req_chat_service_citations',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      conversationId: 'conversation_1',
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'What is the cargo capacity?' }],
        },
      ] as never,
    });

    expect(response.status).toBe(200);
    await Promise.resolve();
    await Promise.resolve();

    expect(toolCallFindMany).toHaveBeenCalledWith({
      where: {
        agentRunId: 'agent_run_1',
        name: 'retrieve_chunks',
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        result: true,
      },
    });
    expect(messageCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: 'conversation_1',
          role: 'ASSISTANT',
          content: 'The Cymbal Starlight can carry 4,500 metric tons.',
          citations: [
            {
              toolCallId: 'tool_call_1',
              chunkId: 'chunk_1',
              documentId: 'document_1',
              documentName: 'Cymbal Starlight Manual',
              chunkIndex: 7,
              score: 0.98,
              snippet: 'Cargo capacity: 4,500 metric tons with balanced load distribution.',
            },
          ],
        }),
      }),
    );
    const assistantPayload = messageCreate.mock.calls[1]?.[0]?.data;
    expect(assistantPayload.citations[0]).not.toHaveProperty('content');
    expect(assistantPayload.citations[0]).not.toHaveProperty('metadata');
    expect(assistantPayload.citations[0]).not.toHaveProperty('rawPayload');
  });
});
