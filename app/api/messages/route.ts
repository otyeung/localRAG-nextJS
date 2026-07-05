import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db/prisma';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { rateLimit } from '@/lib/security/rate-limit';

const messagesQuerySchema = z.object({
  conversationId: z.string().trim().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'messages-api',
      action: 'get',
      errorMessage: 'Too many message requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`messages:get:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'messages-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many message requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const url = new URL(request.url);
    const query = validateWithSchema(
      messagesQuerySchema,
      {
        conversationId: url.searchParams.get('conversationId') ?? undefined,
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
        order: url.searchParams.get('order') ?? undefined,
      },
      'Invalid message query parameters.',
    );

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

    const where = { conversationId: query.conversationId };
    const [items, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { createdAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.message.count({ where }),
    ]);

    return jsonOk({
      items: items.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        citations: message.citations,
        toolCalls: message.toolCalls,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      order: query.order,
    });
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
