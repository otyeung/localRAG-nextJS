import type { UIMessage } from 'ai';
import { z } from 'zod';

import { getCurrentUser } from '@/lib/auth/current-user';
import { AppError, toAppError } from '@/lib/http/api-errors';
import { jsonError } from '@/lib/http/api-response';
import { validateWithSchema } from '@/lib/http/route-validation';
import { getRequestContext } from '@/lib/http/request-context';
import { enforcePreProvisionRouteRateLimit } from '@/lib/security/pre-provision-rate-limit';
import { assertSameOrigin } from '@/lib/security/csrf';
import { rateLimit } from '@/lib/security/rate-limit';
import { ChatService } from '@/lib/services/chat-service';

const chatService = new ChatService();
const chatRequestSchema = z.object({
  id: z.string().optional(),
  conversationId: z.string().optional(),
  messages: z.array(z.custom<UIMessage>()),
  activeAgentName: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const requestContext = getRequestContext(request);

  try {
    assertSameOrigin(request);
    await enforcePreProvisionRouteRateLimit(request, requestContext, {
      namespace: 'chat-api',
      action: 'post',
      errorMessage: 'Too many chat requests.',
    });
    const user = await getCurrentUser(request);
    const rateLimitResult = await rateLimit(`chat:post:${user.id}:${requestContext.ipAddress}`, {
      namespace: 'chat-api',
      limit: 20,
      windowMs: 60_000,
    });

    if (!rateLimitResult.allowed) {
      throw new AppError('RATE_LIMITED', 'Too many chat requests.', {
        resetAt: rateLimitResult.resetAt.toISOString(),
      });
    }

    const body = validateWithSchema(chatRequestSchema, await request.json(), 'Invalid chat request payload.');

    return chatService.streamChat({
      ...body,
      userId: user.id,
      requestId: requestContext.requestId,
      ipAddress: requestContext.ipAddress,
      userAgent: requestContext.userAgent,
    });
  } catch (error) {
    return jsonError(toAppError(error), requestContext.requestId);
  }
}
