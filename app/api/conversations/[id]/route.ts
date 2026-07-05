import { ConversationStatus } from '@prisma/client';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { setConversationTitleSource } from '@/lib/conversations/title-source';
import { prisma } from '@/lib/db/prisma';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError, jsonOk } from '@/lib/http/api-response';
import { parseJsonBody, validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';

const routeParamsSchema = z.object({
  id: z.string().trim().min(1, 'Conversation id is required.'),
});

const patchConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  })
  .refine((value) => value.title !== undefined || value.status !== undefined, {
    message: 'At least one conversation field must be updated.',
  });

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function getActiveAgentName(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  return 'activeAgentName' in metadata && typeof metadata.activeAgentName === 'string'
    ? metadata.activeAgentName
    : null;
}

function toConversationDetail(conversation: {
  id: string;
  title: string;
  status: ConversationStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
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
    deletedAt: conversation.deletedAt?.toISOString() ?? null,
    messageCount: conversation._count?.messages ?? 0,
    lastMessagePreview: conversation.messages?.[0]?.content ?? null,
    activeAgentName: getActiveAgentName(conversation.agentRuns?.[0]?.metadata),
  };
}

function buildConversationUpdateAudit(input: {
  previousStatus: ConversationStatus;
  nextStatus: ConversationStatus;
  titleUpdated: boolean;
}) {
  const changedFields = [
    ...(input.titleUpdated ? ['title'] : []),
    ...(input.previousStatus !== input.nextStatus ? ['status'] : []),
  ];

  if (input.titleUpdated && input.previousStatus === input.nextStatus) {
    return {
      action: 'conversation.renamed',
      metadata: {
        source: 'conversations-api',
        titleUpdated: true,
        changedFields,
      },
    };
  }

  return {
    action: input.previousStatus !== input.nextStatus ? 'conversation.updated' : 'conversation.renamed',
    metadata: {
      source: 'conversations-api',
      titleUpdated: input.titleUpdated,
      changedFields,
      previousStatus: input.previousStatus,
      nextStatus: input.nextStatus,
    },
  };
}

async function getOwnedConversation(userId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id,
      userId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
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
  });

  if (!conversation) {
    throw new AppError('NOT_FOUND', 'Conversation not found.');
  }

  return conversation;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    const { id } = validateWithSchema(routeParamsSchema, await context.params, 'Invalid conversation route parameters.');
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'conversations-api',
      action: 'get',
      errorMessage: 'Too many conversation requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`conversations:get-one:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'conversations-api',
      limit: 60,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many conversation requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    return jsonOk(toConversationDetail(await getOwnedConversation(user.id, id)));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    const { id } = validateWithSchema(routeParamsSchema, await context.params, 'Invalid conversation route parameters.');
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'conversations-api',
      action: 'patch',
      errorMessage: 'Too many conversation requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`conversations:patch:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'conversations-api',
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many conversation requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const body = validateWithSchema(patchConversationSchema, await parseJsonBody(request), 'Invalid conversation payload.');
    const updated = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.conversation.findFirst({
        where: {
          id,
          userId: user.id,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          status: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
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
      });

      if (!existing) {
        throw new AppError('NOT_FOUND', 'Conversation not found.');
      }

      const nextStatus = body.status !== undefined ? ConversationStatus[body.status] : existing.status;
      const updated = await transaction.conversation.update({
        where: { id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.title !== undefined
            ? { metadata: setConversationTitleSource(existing.metadata, 'user') }
            : {}),
          ...(body.status !== undefined ? { status: nextStatus } : {}),
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
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
      });
      const audit = buildConversationUpdateAudit({
        previousStatus: existing.status,
        nextStatus: updated.status,
        titleUpdated: body.title !== undefined,
      });
      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: audit.action,
          entityType: 'conversation',
          entityId: id,
          requestId: requestContext.requestId,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          metadata: audit.metadata,
        },
      });

      return updated;
    });

    return jsonOk(toConversationDetail(updated));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    const { id } = validateWithSchema(routeParamsSchema, await context.params, 'Invalid conversation route parameters.');
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'conversations-api',
      action: 'delete',
      errorMessage: 'Too many conversation requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`conversations:delete:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'conversations-api',
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many conversation requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const deleted = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.conversation.findFirst({
        where: {
          id,
          userId: user.id,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      if (!existing) {
        throw new AppError('NOT_FOUND', 'Conversation not found.');
      }

      const deleted = await transaction.conversation.update({
        where: { id },
        data: {
          status: ConversationStatus.DELETED,
          deletedAt: new Date(),
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
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
      });
      await transaction.auditLog.create({
        data: {
          userId: user.id,
          action: 'conversation.deleted',
          entityType: 'conversation',
          entityId: id,
          requestId: requestContext.requestId,
          ipAddress: requestContext.ipAddress,
          userAgent: requestContext.userAgent,
          metadata: {
            source: 'conversations-api',
            deleted: true,
          },
        },
      });

      return deleted;
    });

    return jsonOk(toConversationDetail(deleted));
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
