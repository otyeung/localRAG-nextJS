import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db/prisma';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { rateLimit } from '@/lib/security/rate-limit';

const searchQuerySchema = z.object({
  query: z.string().trim().min(1),
  conversationId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

function buildSnippet(value: string, maxLength = 200): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'search-api',
      action: 'get',
      errorMessage: 'Too many search requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`search:get:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'search-api',
      limit: 30,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many search requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const url = new URL(request.url);
    const query = validateWithSchema(
      searchQuerySchema,
      {
        query: url.searchParams.get('query') ?? undefined,
        conversationId: url.searchParams.get('conversationId') ?? undefined,
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      },
      'Invalid search query parameters.',
    );

    if (query.conversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: query.conversationId,
          userId: user.id,
          deletedAt: null,
        },
        select: { id: true },
      });

      if (!conversation) {
        throw new AppError('NOT_FOUND', 'Conversation not found.');
      }
    }

    const conversationWhere = {
      userId: user.id,
      deletedAt: null,
      ...(query.conversationId ? { id: query.conversationId } : {}),
      OR: [
        { title: { contains: query.query, mode: 'insensitive' as const } },
        { searchText: { contains: query.query, mode: 'insensitive' as const } },
      ],
    };

    const messageWhere = {
      conversation: {
        userId: user.id,
        deletedAt: null,
      },
      ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      content: {
        contains: query.query,
        mode: 'insensitive' as const,
      },
    };

    const [conversations, messages, totalConversations, totalMessages] = await Promise.all([
      prisma.conversation.findMany({
        where: conversationWhere,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.message.findMany({
        where: messageWhere,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          role: true,
          content: true,
          citations: true,
          createdAt: true,
          conversation: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      }),
      prisma.conversation.count({ where: conversationWhere }),
      prisma.message.count({ where: messageWhere }),
    ]);

    return jsonOk({
      conversations: conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      })),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        snippet: buildSnippet(message.content),
        citations: message.citations,
        createdAt: message.createdAt.toISOString(),
        conversationId: message.conversation.id,
        conversationTitle: message.conversation.title,
      })),
      totalConversations,
      totalMessages,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
