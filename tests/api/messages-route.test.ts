import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforcePreProvisionRouteRateLimit: vi.fn(),
  rateLimit: vi.fn(),
  conversationFindFirst: vi.fn(),
  messageFindMany: vi.fn(),
  messageCount: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: routeMocks.getCurrentUser,
}));

vi.mock('@/lib/security/pre-provision-rate-limit', () => ({
  enforcePreProvisionRouteRateLimit: routeMocks.enforcePreProvisionRouteRateLimit,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: routeMocks.rateLimit,
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    conversation: {
      findFirst: routeMocks.conversationFindFirst,
    },
    message: {
      findMany: routeMocks.messageFindMany,
      count: routeMocks.messageCount,
    },
  },
}));

import { GET } from '@/app/api/messages/route';

describe('messages route', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.enforcePreProvisionRouteRateLimit.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.conversationFindFirst.mockReset();
    routeMocks.messageFindMany.mockReset();
    routeMocks.messageCount.mockReset();

    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.enforcePreProvisionRouteRateLimit.mockResolvedValue(undefined);
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    routeMocks.conversationFindFirst.mockResolvedValue({ id: 'conversation_1' });
    routeMocks.messageCount.mockResolvedValue(1);
  });

  it('returns safe public message metadata without exposing internal persisted payloads', async () => {
    routeMocks.messageFindMany.mockResolvedValue([
      {
        id: 'message_1',
        role: 'ASSISTANT',
        content: 'Transcript restored.',
        citations: null,
        toolCalls: [
          {
            id: 'tool_call_1',
            name: 'retrieve_chunks',
            status: 'COMPLETED',
            arguments: { query: 'quarterly report' },
            result: { chunks: [{ id: 'chunk_1' }] },
          },
          {
            id: 'tool_call_2',
            name: 'search_documents',
            status: 'FAILED',
            errorMessage: 'Lookup failed.',
            metadata: { requestId: 'hidden' },
          },
        ],
        metadata: {
          activeAgentName: 'Knowledge agent',
          agent: 'Knowledge agent',
          model: 'gpt-4.1-mini',
          requestId: 'req_hidden',
          agentRunId: 'run_hidden',
        },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const request = new Request('https://app.example.com/api/messages?conversationId=conversation_1', {
      headers: {
        'user-agent': 'vitest',
        'x-request-id': 'req_messages',
      },
    });

    const response = await GET(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        items: [
          {
            id: 'message_1',
            role: 'ASSISTANT',
            content: 'Transcript restored.',
            citations: null,
            toolCalls: [
              {
                id: 'tool_call_1',
                name: 'retrieve_chunks',
                status: 'COMPLETED',
              },
              {
                id: 'tool_call_2',
                name: 'search_documents',
                status: 'FAILED',
                errorMessage: 'Lookup failed.',
              },
            ],
            metadata: {
              activeAgentName: 'Knowledge agent',
              agent: 'Knowledge agent',
              model: 'gpt-4.1-mini',
            },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
        order: 'asc',
      },
    });
  });
});
