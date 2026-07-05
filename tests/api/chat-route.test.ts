import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const routeMocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  enforcePreProvisionRouteRateLimit: vi.fn(),
  rateLimit: vi.fn(),
  streamChat: vi.fn(),
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

vi.mock('@/lib/services/chat-service', () => ({
  ChatService: class {
    streamChat = routeMocks.streamChat;
  },
}));

import { POST } from '@/app/api/chat/route';

describe('chat route', () => {
  beforeEach(() => {
    routeMocks.getCurrentUser.mockReset();
    routeMocks.enforcePreProvisionRouteRateLimit.mockReset();
    routeMocks.rateLimit.mockReset();
    routeMocks.streamChat.mockReset();

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
    routeMocks.streamChat.mockResolvedValue(
      Response.json({
        streamed: true,
      }),
    );
  });

  it('validates the request body and delegates streaming chat to the chat service', async () => {
    const request = new Request('https://app.example.com/api/chat', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_chat',
        'user-agent': 'vitest',
      },
      body: JSON.stringify({
        id: 'chat_request_1',
        conversationId: 'conversation_1',
        activeAgentName: 'GeneralAssistantAgent',
        messages: [
          {
            id: 'message_1',
            role: 'user',
            parts: [{ type: 'text', text: 'Summarize my uploaded manuals.' }],
          },
        ],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      streamed: true,
    });
    expect(routeMocks.streamChat).toHaveBeenCalledWith({
      id: 'chat_request_1',
      userId: 'user_1',
      requestId: 'req_chat',
      ipAddress: 'unknown',
      userAgent: 'vitest',
      conversationId: 'conversation_1',
      activeAgentName: 'GeneralAssistantAgent',
      messages: [
        {
          id: 'message_1',
          role: 'user',
          parts: [{ type: 'text', text: 'Summarize my uploaded manuals.' }],
        },
      ],
    });
  });

  it('returns structured validation errors for invalid request bodies', async () => {
    const request = new Request('https://app.example.com/api/chat', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://app.example.com',
        'x-request-id': 'req_chat_invalid',
      },
      body: JSON.stringify({
        messages: 'not-an-array',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid chat request payload.',
        requestId: 'req_chat_invalid',
        details: {
          formErrors: [],
          fieldErrors: {
            messages: expect.any(Array),
          },
        },
      },
    });
    expect(routeMocks.streamChat).not.toHaveBeenCalled();
  });

  it('rejects cross-origin chat requests before reading the request body', async () => {
    const request = new Request('https://app.example.com/api/chat', {
      method: 'POST',
      headers: {
        host: 'app.example.com',
        origin: 'https://evil.example.com',
        'x-request-id': 'req_chat_csrf',
      },
      body: JSON.stringify({
        messages: [],
      }),
    });
    const jsonSpy = vi.spyOn(request, 'json');

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: 'FORBIDDEN',
        message: 'Cross-origin mutation rejected.',
        requestId: 'req_chat_csrf',
      },
    });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(routeMocks.streamChat).not.toHaveBeenCalled();
  });
});
