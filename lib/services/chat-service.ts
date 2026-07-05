import 'server-only';

import { AgentRunStatus, ConversationStatus, MessageRole, Prisma } from '@prisma/client';
import { run, type Agent, type AgentInputItem, type StreamedRunResult } from '@openai/agents';
import { createAiSdkUiMessageStreamResponse } from '@openai/agents-extensions/ai-sdk-ui';
import { z } from 'zod';

import { agentRegistry, defaultAgentName } from '@/agents/registry';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';
import { env } from '@/lib/config/env';
import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { logger } from '@/lib/logger/logger';
import { toAgentInput } from '@/lib/openai/message-converters';
import type { AppUiMessage } from '@/lib/openai/ui-messages';
import { extractMessageText } from '@/lib/openai/ui-messages';
import { DocumentService } from '@/lib/services/document-service';
import { N8nRetrievalService } from '@/lib/n8n/retrieval';
import { SettingsService } from '@/lib/services/settings-service';
import { WorkflowService } from '@/lib/services/workflow-service';

type ChatDb = Pick<typeof prisma, '$transaction' | 'conversation' | 'message' | 'agentRun' | 'toolCall' | 'auditLog'>;
type ChatTransactionDb = Prisma.TransactionClient;
type ChatAgent = Agent<AgentToolRuntimeContext, any>;
type AssistantCitation = {
  toolCallId?: string;
  chunkId: string;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  score: number;
  snippet: string;
};

const retrieveChunksToolResultSchema = z.object({
  chunks: z.array(
    z.object({
      id: z.string(),
      documentId: z.string(),
      documentName: z.string(),
      chunkIndex: z.number().int(),
      content: z.string(),
      score: z.number(),
    }),
  ),
});

type ChatStreamRunner = (
  agent: ChatAgent,
  input: string | AgentInputItem[],
  options: {
    stream: true;
    conversationId: string;
    context: AgentToolRuntimeContext;
  },
) => Promise<StreamedRunResult<AgentToolRuntimeContext, ChatAgent>>;

export type StreamChatInput = {
  id?: string;
  userId: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  conversationId?: string;
  activeAgentName?: string;
  messages: AppUiMessage[];
};

function deriveConversationTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return 'New Chat';
  }

  return normalized.length > 80 ? `${normalized.slice(0, 79).trimEnd()}…` : normalized;
}

function mergeSearchText(current: string | null | undefined, values: string[]): string {
  const merged = [current ?? '', ...values]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return merged.slice(0, 10_000);
}

function getLatestUserMessage(messages: AppUiMessage[]): AppUiMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'user');
}

function getAssistantText(stream: StreamedRunResult<AgentToolRuntimeContext, ChatAgent>): string {
  return typeof stream.finalOutput === 'string' ? stream.finalOutput.trim() : '';
}

function toCitationSnippet(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= 280) {
    return normalized;
  }

  return `${normalized.slice(0, 279).trimEnd()}…`;
}

function extractAssistantCitations(
  toolCalls: Array<{
    id: string;
    name: string;
    result: Prisma.JsonValue;
  }>,
): AssistantCitation[] {
  const citations: AssistantCitation[] = [];
  const seen = new Set<string>();

  for (const toolCall of toolCalls) {
    const parsedResult = retrieveChunksToolResultSchema.safeParse(toolCall.result);
    if (!parsedResult.success) {
      continue;
    }

    for (const chunk of parsedResult.data.chunks) {
      const citationKey = `${toolCall.id}:${chunk.id}`;
      if (seen.has(citationKey)) {
        continue;
      }

      seen.add(citationKey);
      citations.push({
        toolCallId: toolCall.id,
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
        snippet: toCitationSnippet(chunk.content),
      });
    }
  }

  return citations;
}

function toAuditMetadata(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return value;
}

export class ChatService {
  constructor(
    private readonly dependencies: {
      db?: ChatDb;
      settingsService?: Pick<SettingsService, 'getForUser'>;
      documentService?: DocumentService;
      workflowService?: WorkflowService;
      retrievalService?: N8nRetrievalService;
      runAgent?: ChatStreamRunner;
      streamResponseFactory?: typeof createAiSdkUiMessageStreamResponse;
    } = {},
  ) {}

  private get db(): ChatDb {
    return this.dependencies.db ?? prisma;
  }

  private get settingsService(): Pick<SettingsService, 'getForUser'> {
    return this.dependencies.settingsService ?? new SettingsService();
  }

  private get runAgent(): ChatStreamRunner {
    return this.dependencies.runAgent ?? (run as ChatStreamRunner);
  }

  private get streamResponseFactory(): typeof createAiSdkUiMessageStreamResponse {
    return this.dependencies.streamResponseFactory ?? createAiSdkUiMessageStreamResponse;
  }

  async streamChat(input: StreamChatInput): Promise<Response> {
    const agentInput = toAgentInput(input.messages);
    if (agentInput.length === 0) {
      throw new AppError('BAD_REQUEST', 'At least one non-empty chat message is required.');
    }

    const latestUserMessage = getLatestUserMessage(input.messages);
    const latestUserText = latestUserMessage ? extractMessageText(latestUserMessage).trim() : '';
    if (!latestUserText) {
      throw new AppError('BAD_REQUEST', 'A non-empty user message is required.');
    }

    const selectedAgent = await this.resolveAgent(input.userId, input.activeAgentName);
    const { conversation, userMessage, agentRun, nextSearchText } = await this.db.$transaction(
      async (transaction: ChatTransactionDb) => {
        const conversation = await this.ensureConversation(transaction, {
          userId: input.userId,
          conversationId: input.conversationId,
          latestUserText,
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });
        const nextSearchText = mergeSearchText(conversation.searchText, [latestUserText]);

        const userMessage = await transaction.message.create({
          data: {
            conversationId: conversation.id,
            role: MessageRole.USER,
            content: latestUserText,
            metadata: {
              clientMessageId: latestUserMessage?.id,
              requestId: input.requestId,
            },
          },
        });
        await transaction.conversation.update({
          where: { id: conversation.id },
          data: {
            searchText: nextSearchText,
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: 'message.created',
            entityType: 'message',
            entityId: userMessage.id,
            requestId: input.requestId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: toAuditMetadata({
              source: 'chat-api',
              conversationId: conversation.id,
              role: MessageRole.USER,
              clientMessageId: latestUserMessage?.id ?? null,
            }),
          },
        });

        const agentRun = await transaction.agentRun.create({
          data: {
            conversationId: conversation.id,
            status: AgentRunStatus.RUNNING,
            model: typeof selectedAgent.model === 'string' ? selectedAgent.model : env.openai.model,
            provider: 'openai',
            metadata: {
              activeAgentName: selectedAgent.name,
              requestId: input.requestId,
              userMessageId: userMessage.id,
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            userId: input.userId,
            action: 'agent_run.created',
            entityType: 'agent_run',
            entityId: agentRun.id,
            requestId: input.requestId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: toAuditMetadata({
              source: 'chat-api',
              conversationId: conversation.id,
              activeAgentName: selectedAgent.name,
              model: typeof selectedAgent.model === 'string' ? selectedAgent.model : env.openai.model,
              provider: 'openai',
              userMessageId: userMessage.id,
            }),
          },
        });

        return { conversation, userMessage, agentRun, nextSearchText };
      },
    );

    try {
      const stream = await this.runAgent(selectedAgent, agentInput, {
        stream: true,
        conversationId: conversation.id,
        context: {
          userId: input.userId,
          conversationId: conversation.id,
          agentRunId: agentRun.id,
          requestId: input.requestId,
        },
      });

      void stream.completed
        .then(async () => {
          const assistantText = getAssistantText(stream);
          await this.db.$transaction(async (transaction) => {
            const assistantCitations = await transaction.toolCall.findMany({
              where: {
                agentRunId: agentRun.id,
                name: 'retrieve_chunks',
                status: 'COMPLETED',
              },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                name: true,
                result: true,
              },
            });
            const citations = extractAssistantCitations(assistantCitations);

            if (assistantText) {
              await transaction.message.create({
                data: {
                  conversationId: conversation.id,
                  role: MessageRole.ASSISTANT,
                  content: assistantText,
                  citations: citations.length > 0 ? citations : Prisma.JsonNull,
                  metadata: {
                    activeAgentName: stream.activeAgent?.name ?? selectedAgent.name,
                    requestId: input.requestId,
                    agentRunId: agentRun.id,
                  },
                },
              });
            }

            await transaction.agentRun.update({
              where: { id: agentRun.id },
              data: {
                status: AgentRunStatus.COMPLETED,
                completedAt: new Date(),
                metadata: {
                  activeAgentName: stream.activeAgent?.name ?? selectedAgent.name,
                  requestId: input.requestId,
                  lastResponseId: stream.lastResponseId,
                  userMessageId: userMessage.id,
                },
              },
            });

            await transaction.conversation.update({
              where: { id: conversation.id },
              data: {
                searchText: mergeSearchText(nextSearchText, [assistantText]),
              },
            });
          });
        })
        .catch(async (error) => {
          logger.error(
            {
              err: error,
              conversationId: conversation.id,
              agentRunId: agentRun.id,
              requestId: input.requestId,
            },
            'Streaming chat completion failed.',
          );
          await this.db.agentRun.update({
            where: { id: agentRun.id },
            data: {
              status: AgentRunStatus.FAILED,
              completedAt: new Date(),
              metadata: {
                activeAgentName: selectedAgent.name,
                requestId: input.requestId,
                errorMessage: error instanceof Error ? error.message : 'An unexpected stream failure occurred.',
                userMessageId: userMessage.id,
              },
            },
          });
        });

      return this.streamResponseFactory(stream);
    } catch (error) {
      await this.db.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.FAILED,
          completedAt: new Date(),
          metadata: {
            activeAgentName: selectedAgent.name,
            requestId: input.requestId,
            errorMessage: error instanceof Error ? error.message : 'An unexpected chat failure occurred.',
            userMessageId: userMessage.id,
          },
        },
      });
      throw error instanceof AppError ? error : new AppError('INTERNAL_ERROR', 'Unable to start chat stream.');
    }
  }

  private async ensureConversation(
    transaction: ChatTransactionDb,
    input: {
      userId: string;
      conversationId?: string;
      latestUserText: string;
      requestId: string;
      ipAddress: string;
      userAgent: string;
    },
  ) {
    const derivedTitle = deriveConversationTitle(input.latestUserText);

    if (!input.conversationId) {
      const conversation = await transaction.conversation.create({
        data: {
          userId: input.userId,
          title: derivedTitle,
          searchText: input.latestUserText,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: 'conversation.created',
          entityType: 'conversation',
          entityId: conversation.id,
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: toAuditMetadata({
            source: 'chat-api',
            creationMode: 'implicit',
          }),
        },
      });

      return conversation;
    }

    const conversation = await transaction.conversation.findFirst({
      where: {
        id: input.conversationId,
        userId: input.userId,
        deletedAt: null,
      },
    });

    if (!conversation) {
      throw new AppError('NOT_FOUND', 'Conversation not found.');
    }

    if (conversation.status === ConversationStatus.DELETED) {
      throw new AppError('NOT_FOUND', 'Conversation not found.');
    }

    if (conversation.title === 'New Chat') {
      const updatedConversation = await transaction.conversation.update({
        where: { id: conversation.id },
        data: {
          title: derivedTitle,
        },
      });
      await transaction.auditLog.create({
        data: {
          userId: input.userId,
          action: 'conversation.renamed',
          entityType: 'conversation',
          entityId: conversation.id,
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: toAuditMetadata({
            source: 'chat-api',
            titleDerived: true,
          }),
        },
      });

      return updatedConversation;
    }

    return conversation;
  }

  private async resolveAgent(userId: string, activeAgentName?: string): Promise<ChatAgent> {
    const requestedAgentName = activeAgentName ?? defaultAgentName;
    const baseAgent = agentRegistry.get(requestedAgentName) as ChatAgent | undefined;

    if (!baseAgent) {
      throw new AppError('BAD_REQUEST', 'Unknown active agent.');
    }

    const settings = await this.settingsService.getForUser(userId);
    return baseAgent.clone({
      model: settings.model || env.openai.model,
    });
  }
}
