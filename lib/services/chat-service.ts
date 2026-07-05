import 'server-only';

import { AgentRunStatus, ConversationStatus, MessageRole } from '@prisma/client';
import { run, type Agent, type AgentInputItem, type StreamedRunResult } from '@openai/agents';
import { createAiSdkUiMessageStreamResponse } from '@openai/agents-extensions/ai-sdk-ui';
import type { UIMessage } from 'ai';

import { agentRegistry, defaultAgentName } from '@/agents/registry';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';
import { env } from '@/lib/config/env';
import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { logger } from '@/lib/logger/logger';
import { N8nRetrievalService } from '@/lib/n8n/retrieval';
import { toAgentInput } from '@/lib/openai/message-converters';
import { ConversationRepository } from '@/lib/repositories/conversation-repository';
import { DocumentService } from '@/lib/services/document-service';
import { SettingsService } from '@/lib/services/settings-service';
import { WorkflowService } from '@/lib/services/workflow-service';

type ChatDb = Pick<typeof prisma, '$transaction' | 'conversation' | 'message' | 'agentRun' | 'toolCall'>;
type ChatAgent = Agent<AgentToolRuntimeContext, any>;

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
  messages: UIMessage[];
};

function collectMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<(typeof message.parts)[number], { type: 'text' }> => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

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

function getLatestUserMessage(messages: UIMessage[]): UIMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'user');
}

function getAssistantText(stream: StreamedRunResult<AgentToolRuntimeContext, ChatAgent>): string {
  return typeof stream.finalOutput === 'string' ? stream.finalOutput.trim() : '';
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
    const latestUserText = latestUserMessage ? collectMessageText(latestUserMessage) : '';
    if (!latestUserText) {
      throw new AppError('BAD_REQUEST', 'A non-empty user message is required.');
    }

    const conversation = await this.ensureConversation(input.userId, input.conversationId, latestUserText);
    const selectedAgent = await this.resolveAgent(input.userId, input.activeAgentName);
    const nextSearchText = mergeSearchText(conversation.searchText, [latestUserText]);

    const userMessage = await this.db.message.create({
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
    await this.db.conversation.update({
      where: { id: conversation.id },
      data: {
        searchText: nextSearchText,
      },
    });

    const agentRun = await this.db.agentRun.create({
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
            if (assistantText) {
              await transaction.message.create({
                data: {
                  conversationId: conversation.id,
                  role: MessageRole.ASSISTANT,
                  content: assistantText,
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

  private async ensureConversation(userId: string, conversationId: string | undefined, latestUserText: string) {
    if (!conversationId) {
      const created = await new ConversationRepository(this.db as never).createForUser(userId, deriveConversationTitle(latestUserText));
      return this.db.conversation.update({
        where: { id: created.id },
        data: {
          searchText: latestUserText,
        },
      });
    }

    const conversation = await this.db.conversation.findFirst({
      where: {
        id: conversationId,
        userId,
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
      return this.db.conversation.update({
        where: { id: conversation.id },
        data: {
          title: deriveConversationTitle(latestUserText),
        },
      });
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
