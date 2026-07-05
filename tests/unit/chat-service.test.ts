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
});
