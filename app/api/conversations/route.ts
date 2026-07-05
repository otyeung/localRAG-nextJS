import { ConversationStatus } from '@prisma/client';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AUTO_TITLE_PLACEHOLDER, setConversationTitleSource } from '@/lib/conversations/title-source';
import { prisma } from '@/lib/db/prisma';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { parseJsonBody, validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';

const listConversationsQuerySchema = z.object({
  query: z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined),
    z.string().min(1).optional(),
  ),
  status: z.enum(Object.keys(ConversationStatus) as [keyof typeof ConversationStatus, ...Array<keyof typeof ConversationStatus>]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createConversationBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

function getActiveAgentName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  return 'activeAgentName' in metadata && typeof metadata.activeAgentName === 'string'
    ? metadata.activeAgentName
    : null;
}

function toConversationSummary(conversation: {
  id: string;
  title: string;
  status: ConversationStatus;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{ content: string }>;
  agentRuns?: Array<{ metadata: unknown }>;
  _count?: { messages: number };
}) {
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messageCount: conversation._count?.messages ?? 0,
    lastMessagePreview: conversation.messages?.[0]?.content ?? null,
    activeAgentName: getActiveAgentName(conversation.agentRuns?.[0]?.metadata),
  };
}

export async function GET(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'conversations-api',
      action: 'get',
      errorMessage: 'Too many conversation requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`conversations:get:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'conversations-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many conversation requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const url = new URL(request.url);
    const query = validateWithSchema(
      listConversationsQuerySchema,
      {
        query: url.searchParams.get('query') ?? undefined,
        status: url.searchParams.get('status') ?? undefined,
        page: url.searchParams.get('page') ?? undefined,
        pageSize: url.searchParams.get('pageSize') ?? undefined,
      },
      'Invalid conversation query parameters.',
    );

    const where = {
      userId: user.id,
      deletedAt: null,
      ...(query.status ? { status: ConversationStatus[query.status] } : {}),
      ...(query.query
        ? {
            OR: [
              { title: { contains: query.query, mode: 'insensitive' as const } },
              { searchText: { contains: query.query, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          messages: {
            select: { content: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          agentRuns: {
            select: { metadata: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    return jsonOk({
      items: items.map(toConversationSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}

export async function POST(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'conversations-api',
      action: 'post',
      errorMessage: 'Too many conversation requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`conversations:post:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'conversations-api',
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many conversation requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const body = validateWithSchema(
      createConversationBodySchema,
      await parseJsonBody(request),
      'Invalid conversation payload.',
    );
    const conversation = await prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: {
          userId: user.id,
          ...(body.title ? { title: body.title } : {}),
          metadata: setConversationTitleSource(null, body.title ? 'user' : 'auto'),
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: 'conversation.created',
          entityType: 'conversation',
          entityId: conversation.id,
          requestId: requestContext.requestId,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          metadata: {
            source: 'conversations-api',
            hasCustomTitle: Boolean(body.title),
            titleSource: body.title ? 'user' : 'auto',
            autoTitlePlaceholder: body.title ? undefined : AUTO_TITLE_PLACEHOLDER,
          },
        },
      });

      return conversation;
    });

    return jsonOk(
      toConversationSummary({
        ...conversation,
        messages: [],
        agentRuns: [],
        _count: { messages: 0 },
      }),
      { status: 201 },
    );
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
