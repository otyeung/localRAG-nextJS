import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforcePreProvisionRouteRateLimit: vi.fn(),
  rateLimit: vi.fn(),
  conversationCreate: vi.fn(),
  conversationFindFirst: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationCount: vi.fn(),
  conversationUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentUser: routeMocks.getCurrentUser,
}));

vi.mock('@/lib/security/rate-limit', () => ({
  rateLimit: routeMocks.rateLimit,
}));

vi.mock('@/lib/security/pre-provision-rate-limit', () => ({
  enforcePreProvisionRouteRateLimit: routeMocks.enforcePreProvisionRouteRateLimit,
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: routeMocks.transaction,
    conversation: {
      create: routeMocks.conversationCreate,
      findFirst: routeMocks.conversationFindFirst,
      findMany: routeMocks.conversationFindMany,
      count: routeMocks.conversationCount,
      update: routeMocks.conversationUpdate,
    },
    auditLog: {
      create: routeMocks.auditLogCreate,
    },
  },
}));

import { POST } from '@/app/api/conversations/route';
import { DELETE, PATCH } from '@/app/api/conversations/[id]/route';

describe('conversations routes', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.enforcePreProvisionRouteRateLimit.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.conversationCreate.mockReset();
    routeMocks.conversationFindFirst.mockReset();
    routeMocks.conversationFindMany.mockReset();
    routeMocks.conversationCount.mockReset();
    routeMocks.conversationUpdate.mockReset();
    routeMocks.auditLogCreate.mockReset();
    routeMocks.transaction.mockReset();

    routeMocks.getCurrentUser.mockResolvedValue({
      id: 'user_1',
      displayName: 'Local User',
      provider: 'anonymous',
    });
    routeMocks.enforcePreProvisionRouteRateLimit.mockResolvedValue(undefined);
    routeMocks.rateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    routeMocks.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) =>
      callback({
        conversation: {
          create: routeMocks.conversationCreate,
          findFirst: routeMocks.conversationFindFirst,
          update: routeMocks.conversationUpdate,
        },
        auditLog: {
          create: routeMocks.auditLogCreate,
        },
      }),
    );
  });

  it('creates conversations and records a safe audit log entry', async () => {
    routeMocks.conversationCreate.mockResolvedValue({
      id: 'conversation_1',
      title: 'Project Kickoff',
      status: 'ACTIVE',
      metadata: {
        titleSource: 'user',
      },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const request = new Request('https://app.example.com/api/conversations', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'user-agent': 'vitest',
        'x-request-id': 'req_conversation_create',
      },
      body: JSON.stringify({
        title: 'Project Kickoff',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: {
        id: 'conversation_1',
        title: 'Project Kickoff',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        messageCount: 0,
        lastMessagePreview: null,
        activeAgentName: null,
      },
    });
    expect(routeMocks.transaction).toHaveBeenCalledOnce();
    expect(routeMocks.conversationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        title: 'Project Kickoff',
        metadata: {
          titleSource: 'user',
        },
      },
    });
    expect(routeMocks.auditLogCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        action: 'conversation.created',
        entityType: 'conversation',
        entityId: 'conversation_1',
        requestId: 'req_conversation_create',
        ipAddress: 'unknown',
        userAgent: 'vitest',
        metadata: expect.objectContaining({
          source: 'conversations-api',
          hasCustomTitle: true,
        }),
      },
    });
    const auditEntry = routeMocks.auditLogCreate.mock.calls[0]?.[0];
    expect(auditEntry.data.metadata).not.toHaveProperty('title');
  });

  it('marks explicit "New Chat" titles as user-provided', async () => {
    routeMocks.conversationCreate.mockResolvedValue({
      id: 'conversation_new_chat',
      title: 'New Chat',
      status: 'ACTIVE',
      metadata: {
        titleSource: 'user',
      },
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const request = new Request('https://app.example.com/api/conversations', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_conversation_new_chat_title',
      },
      body: JSON.stringify({
        title: 'New Chat',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(routeMocks.conversationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user_1',
        title: 'New Chat',
        metadata: {
          titleSource: 'user',
        },
      },
    });
  });

  it('returns a structured bad request error for malformed conversation JSON', async () => {
    const request = new Request('https://app.example.com/api/conversations', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'content-type': 'application/json',
        'x-request-id': 'req_conversation_bad_json',
      },
      body: '{',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid JSON body.',
        requestId: 'req_conversation_bad_json',
      },
    });
    expect(routeMocks.conversationCreate).not.toHaveBeenCalled();
    expect(routeMocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid conversation updates with structured validation errors', async () => {
    routeMocks.conversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      title: 'Existing Title',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      messages: [{ content: 'hello' }],
      agentRuns: [],
      _count: { messages: 1 },
    });

    const request = new Request('https://app.example.com/api/conversations/conversation_1', {
      method: 'PATCH',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_conversation_invalid',
      },
      body: JSON.stringify({
        title: '   ',
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'conversation_1' }),
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid conversation payload.',
        requestId: 'req_conversation_invalid',
        details: {
          formErrors: [],
          fieldErrors: {
            title: expect.any(Array),
          },
        },
      },
    });
    expect(routeMocks.conversationUpdate).not.toHaveBeenCalled();
    expect(routeMocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('returns a structured bad request error for malformed conversation patch JSON', async () => {
    const request = new Request('https://app.example.com/api/conversations/conversation_1', {
      method: 'PATCH',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'content-type': 'application/json',
        'x-request-id': 'req_conversation_patch_bad_json',
      },
      body: '{',
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'conversation_1' }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid JSON body.',
        requestId: 'req_conversation_patch_bad_json',
      },
    });
    expect(routeMocks.conversationFindFirst).not.toHaveBeenCalled();
    expect(routeMocks.conversationUpdate).not.toHaveBeenCalled();
    expect(routeMocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it('renames conversations and records safe audit metadata without prompt text', async () => {
    routeMocks.conversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      title: 'Old Title',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      messages: [{ content: 'hello' }],
      agentRuns: [],
      _count: { messages: 1 },
    });
    routeMocks.conversationUpdate.mockResolvedValue({
      id: 'conversation_1',
      title: 'New Title',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      deletedAt: null,
      messages: [{ content: 'hello' }],
      agentRuns: [],
      _count: { messages: 1 },
    });

    const request = new Request('https://app.example.com/api/conversations/conversation_1', {
      method: 'PATCH',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'user-agent': 'vitest',
        'x-request-id': 'req_conversation_patch',
      },
      body: JSON.stringify({
        title: 'New Title',
      }),
    });

    const response = await PATCH(request, {
      params: Promise.resolve({ id: 'conversation_1' }),
    });

    expect(response.status).toBe(200);
    expect(routeMocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_1',
        action: 'conversation.renamed',
        entityType: 'conversation',
        entityId: 'conversation_1',
        requestId: 'req_conversation_patch',
      }),
    });
    const auditEntry = routeMocks.auditLogCreate.mock.calls[0]?.[0];
    expect(auditEntry.data.metadata).toMatchObject({
      source: 'conversations-api',
      titleUpdated: true,
    });
    expect(auditEntry.data.metadata).not.toHaveProperty('title');
    expect(auditEntry.data.metadata).not.toHaveProperty('previousTitle');
  });

  it('soft deletes conversations and records a delete audit entry', async () => {
    routeMocks.conversationFindFirst.mockResolvedValue({
      id: 'conversation_1',
      title: 'Delete Me',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deletedAt: null,
      messages: [{ content: 'hello' }],
      agentRuns: [],
      _count: { messages: 1 },
    });
    routeMocks.conversationUpdate.mockResolvedValue({
      id: 'conversation_1',
      title: 'Delete Me',
      status: 'DELETED',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      deletedAt: new Date('2026-01-02T00:00:00.000Z'),
      messages: [{ content: 'hello' }],
      agentRuns: [],
      _count: { messages: 1 },
    });

    const request = new Request('https://app.example.com/api/conversations/conversation_1', {
      method: 'DELETE',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'user-agent': 'vitest',
        'x-request-id': 'req_conversation_delete',
      },
    });

    const response = await DELETE(request, {
      params: Promise.resolve({ id: 'conversation_1' }),
    });

    expect(response.status).toBe(200);
    expect(routeMocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_1',
        action: 'conversation.deleted',
        entityType: 'conversation',
        entityId: 'conversation_1',
        requestId: 'req_conversation_delete',
      }),
    });
  });
});
