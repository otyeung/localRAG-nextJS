import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { prisma } from '@/lib/db/prisma';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { rateLimit } from '@/lib/security/rate-limit';
import {
  extractAgentRunId,
  sanitizePublicMessageMetadata,
  sanitizePublicToolCalls,
} from '@/lib/chat/public-message-ui';

const messagesQuerySchema = z.object({
  conversationId: z.string().trim().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  order: z.enum(['asc', 'desc']).default('asc'),
});

function mergePublicMetadata(primary: unknown, fallback: unknown) {
  const safePrimary = sanitizePublicMessageMetadata(primary) ?? {};
  const safeFallback = sanitizePublicMessageMetadata(fallback) ?? {};

  return sanitizePublicMessageMetadata({
    ...safeFallback,
    ...safePrimary,
  });
}

type AgentRunHydrationRecord = {
  id: string;
  model: string | null;
  metadata: unknown;
  toolCalls: Array<{
    id: string;
    name: string;
    status: 'STARTED' | 'COMPLETED' | 'FAILED';
    errorMessage: string | null;
  }>;
};

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
    const missingAgentRunIds = [
      ...new Set(items.map((message) => extractAgentRunId(message.metadata)).filter((agentRunId): agentRunId is string => Boolean(agentRunId))),
    ];
    const agentRuns: AgentRunHydrationRecord[] =
      missingAgentRunIds.length > 0
        ? await prisma.agentRun.findMany({
            where: {
              id: {
                in: missingAgentRunIds,
              },
            },
            select: {
              id: true,
              model: true,
              metadata: true,
              toolCalls: {
                select: {
                  id: true,
                  name: true,
                  status: true,
                  errorMessage: true,
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          })
        : [];
    const agentRunById = new Map(agentRuns.map((agentRun) => [agentRun.id, agentRun]));

    return jsonOk({
      items: items.map((message) => {
        const agentRunId = extractAgentRunId(message.metadata);
        const agentRun = agentRunId ? agentRunById.get(agentRunId) : undefined;
        const toolCalls = sanitizePublicToolCalls(message.toolCalls);
        const metadata = mergePublicMetadata(message.metadata, {
          model: agentRun?.model,
          activeAgentName:
            agentRun?.metadata && typeof agentRun.metadata === 'object' && !Array.isArray(agentRun.metadata)
              ? (agentRun.metadata as Record<string, unknown>).activeAgentName
              : undefined,
        });

        return {
          id: message.id,
          role: message.role,
          content: message.content,
          citations: message.citations,
          toolCalls: toolCalls.length > 0 ? toolCalls : sanitizePublicToolCalls(agentRun?.toolCalls),
          metadata,
          createdAt: message.createdAt.toISOString(),
          updatedAt: message.updatedAt.toISOString(),
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
      order: query.order,
    });
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
