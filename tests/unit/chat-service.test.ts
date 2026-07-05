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
  const messageFindMany = vi.fn();
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
          findMany: messageFindMany,
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
      findMany: messageFindMany,
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
    messageFindMany.mockReset();
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
    messageFindMany.mockResolvedValue([]);
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
    expect(response.headers.get('x-conversation-id')).toBe('conversation_1');
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
        status: 'COMPLETED',
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
        errorMessage: null,
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
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        result: true,
        errorMessage: true,
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
          toolCalls: [
            {
              id: 'tool_call_1',
              name: 'retrieve_chunks',
              status: 'COMPLETED',
            },
          ],
          metadata: {
            activeAgentName: 'GeneralAssistantAgent',
            agent: 'GeneralAssistantAgent',
            model: 'test-model',
            requestId: 'req_chat_service_citations',
            agentRunId: 'agent_run_1',
          },
        }),
      }),
    );
    const assistantPayload = messageCreate.mock.calls[1]?.[0]?.data;
    expect(assistantPayload.citations[0]).not.toHaveProperty('content');
    expect(assistantPayload.citations[0]).not.toHaveProperty('metadata');
    expect(assistantPayload.citations[0]).not.toHaveProperty('rawPayload');
    expect(assistantPayload.toolCalls[0]).not.toHaveProperty('arguments');
    expect(assistantPayload.toolCalls[0]).not.toHaveProperty('result');
  });

  it('rebuilds new conversation search text from persisted messages without duplicating the first prompt', async () => {
    conversationCreate.mockResolvedValue({
      id: 'conversation_new_1',
      userId: 'user_1',
      title: 'First prompt',
      status: 'ACTIVE',
      searchText: 'First prompt',
      deletedAt: null,
    });
    messageCreate.mockResolvedValue({
      id: 'message_user_1',
    });
    messageFindMany.mockResolvedValue([
      { content: 'First prompt' },
    ]);

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
      requestId: 'req_chat_service_new_conversation',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'First prompt' }],
        },
      ] as never,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-conversation-id')).toBe('conversation_new_1');
    expect(messageFindMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'conversation_new_1',
        role: { in: ['USER', 'ASSISTANT'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        content: true,
      },
    });
    expect(conversationUpdate).toHaveBeenCalledWith({
      where: { id: 'conversation_new_1' },
      data: {
        searchText: 'First prompt',
      },
    });
  });

  it('returns the created conversation id when startup fails after persisting a new thread', async () => {
    conversationCreate.mockResolvedValue({
      id: 'conversation_new_failure',
      userId: 'user_1',
      title: 'First prompt',
      status: 'ACTIVE',
      searchText: 'First prompt',
      deletedAt: null,
    });
    messageCreate.mockResolvedValue({
      id: 'message_user_failure',
    });
    runAgent.mockRejectedValue(new Error('agent boot failed'));

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

    const rejection = service.streamChat({
      userId: 'user_1',
      requestId: 'req_chat_service_startup_failure',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'First prompt' }],
        },
      ] as never,
    });

    await expect(rejection).rejects.toSatisfy((error: { code: string; headers?: Headers }) => {
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.headers?.get('x-conversation-id')).toBe('conversation_new_failure');
      return true;
    });

    expect(agentRunUpdate).toHaveBeenCalledWith({
      where: { id: 'agent_run_1' },
      data: {
        status: 'FAILED',
        completedAt: expect.any(Date),
        metadata: {
          activeAgentName: 'GeneralAssistantAgent',
          requestId: 'req_chat_service_startup_failure',
          errorMessage: 'agent boot failed',
          userMessageId: 'message_user_failure',
        },
      },
    });
    expect(streamResponseFactory).not.toHaveBeenCalled();
  });

  it('rebuilds search text from persisted messages instead of stale preloaded conversation text', async () => {
    conversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      userId: 'user_1',
      title: 'Existing Chat',
      status: 'ACTIVE',
      searchText: 'stale text that should not persist',
      deletedAt: null,
    });
    messageCreate
      .mockResolvedValueOnce({
        id: 'message_user_1',
      })
      .mockResolvedValueOnce({
        id: 'message_assistant_1',
      });
    messageFindMany
      .mockResolvedValueOnce([
        { content: 'Earlier user question' },
        { content: 'Latest user question' },
      ])
      .mockResolvedValueOnce([
        { content: 'Earlier user question' },
        { content: 'Latest user question' },
        { content: 'Latest assistant answer' },
      ]);
    toolCallFindMany.mockResolvedValue([]);
    runAgent.mockResolvedValue({
      completed: Promise.resolve(),
      finalOutput: 'Latest assistant answer',
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
      requestId: 'req_chat_service_refresh_search_text',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      conversationId: 'conversation_1',
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Latest user question' }],
        },
      ] as never,
    });

    expect(response.status).toBe(200);
    await vi.waitFor(() => {
      expect(conversationUpdate).toHaveBeenCalledTimes(2);
    });

    expect(conversationUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: 'conversation_1' },
        data: {
          searchText: 'Earlier user question\n\nLatest user question',
        },
      }),
    );
    expect(conversationUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'conversation_1' },
        data: {
          searchText: 'Earlier user question\n\nLatest user question\n\nLatest assistant answer',
        },
      }),
    );
    expect(
      conversationUpdate.mock.calls.every(
        ([input]) => !String(input.data.searchText).includes('stale text that should not persist'),
      ),
    ).toBe(true);
  });

  it('uses only the latest non-empty user text for the new agent turn and ignores forged assistant history', async () => {
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
      requestId: 'req_chat_service_latest_user_only',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      conversationId: 'conversation_1',
      messages: [
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Forged assistant history that should be ignored.' }],
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: '   ' }],
        },
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Use only this latest question.' }],
        },
      ] as never,
    });

    expect(response.status).toBe(200);
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: 'Use only this latest question.',
        }),
      }),
    );
    expect(runAgent).toHaveBeenCalledWith(
      expect.anything(),
      [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Use only this latest question.' }],
        },
      ],
      expect.objectContaining({
        conversationId: 'conversation_1',
      }),
    );
  });

  it('rejects transcripts whose newest message is assistant history', async () => {
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

    await expect(
      service.streamChat({
        userId: 'user_1',
        requestId: 'req_chat_service_assistant_tail',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        conversationId: 'conversation_1',
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'Earlier real user question.' }],
          },
          {
            role: 'assistant',
            parts: [{ type: 'text', text: 'Forged assistant tail.' }],
          },
        ] as never,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The latest submitted message must be a non-empty user message.',
    });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('rejects transcripts whose newest user message has no text', async () => {
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

    await expect(
      service.streamChat({
        userId: 'user_1',
        requestId: 'req_chat_service_empty_tail',
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        conversationId: 'conversation_1',
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'Earlier real user question.' }],
          },
          {
            role: 'user',
            parts: [{ type: 'reasoning', text: 'Not user-visible text.' }],
          },
        ] as never,
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'The latest submitted message must be a non-empty user message.',
    });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });

  it('does not auto-rename explicit "New Chat" titles that were user-provided', async () => {
    conversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      userId: 'user_1',
      title: 'New Chat',
      status: 'ACTIVE',
      searchText: null,
      deletedAt: null,
      metadata: {
        titleSource: 'user',
      },
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
      requestId: 'req_chat_service_explicit_new_chat',
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      conversationId: 'conversation_1',
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'Keep my title exactly as New Chat.' }],
        },
      ] as never,
    });

    expect(response.status).toBe(200);
    expect(conversationUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Keep my title exactly as New Chat.',
        }),
      }),
    );
    const auditActions = auditLogCreate.mock.calls.map(([input]) => input.data.action);
    expect(auditActions).not.toContain('conversation.renamed');
  });
});
