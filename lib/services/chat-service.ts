import 'server-only';

import {
  AgentRunStatus,
  ConversationStatus,
  MessageRole,
  Prisma,
} from '@prisma/client';
import {
  run,
  type Agent,
  type AgentInputItem,
  type AgentOutputType,
  type StreamedRunResult,
} from '@openai/agents';
import { createAiSdkUiMessageStreamResponse } from '@openai/agents-extensions/ai-sdk-ui';
import { z } from 'zod';

import { agentRegistry, defaultAgentName } from '@/agents/registry';
import type { AgentToolRuntimeContext } from '@/agents/tools/shared';
import { env } from '@/lib/config/env';
import { sanitizePublicToolCalls } from '@/lib/chat/public-message-ui';
import {
  AUTO_TITLE_PLACEHOLDER,
  getConversationTitleSource,
  setConversationTitleSource,
} from '@/lib/conversations/title-source';
import { prisma } from '@/lib/db/prisma';
import { AppError } from '@/lib/http/api-errors';
import { logger } from '@/lib/logger/logger';
import type { AppUiMessage } from '@/lib/openai/ui-messages';
import { extractMessageText } from '@/lib/openai/ui-messages';
import {
  isHostedOpenAiApiUrl,
  normalizeOpenAiChatCompletionsBaseUrl,
} from '@/lib/openai/api-url';
import { DocumentService } from '@/lib/services/document-service';
import { N8nRetrievalService } from '@/lib/n8n/retrieval';
import type { RetrievedChunk } from '@/lib/n8n/types';
import { SettingsService } from '@/lib/services/settings-service';
import { WorkflowService } from '@/lib/services/workflow-service';

type ChatDb = Pick<
  typeof prisma,
  | '$transaction'
  | 'conversation'
  | 'message'
  | 'agentRun'
  | 'toolCall'
  | 'auditLog'
>;
type ChatTransactionDb = Prisma.TransactionClient;
type ChatAgent = Agent<AgentToolRuntimeContext, AgentOutputType>;
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

function withConversationHeader(
  error: AppError,
  conversationId: string,
): AppError {
  const headers = new Headers(error.headers);
  headers.set('x-conversation-id', conversationId);
  return new AppError(error.code, error.message, error.details, headers);
}

function deriveConversationTitle(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return AUTO_TITLE_PLACEHOLDER;
  }

  return normalized.length > 80
    ? `${normalized.slice(0, 79).trimEnd()}…`
    : normalized;
}

function buildSearchText(values: string[]): string {
  const merged = values
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();

  return merged.slice(0, 10_000);
}

function getLatestSubmittedUserMessage(
  messages: AppUiMessage[],
): AppUiMessage | undefined {
  const latestMessage = messages.at(-1);
  if (!latestMessage || latestMessage.role !== 'user') {
    return undefined;
  }

  return extractMessageText(latestMessage).trim().length > 0
    ? latestMessage
    : undefined;
}

function toLatestUserAgentInput(text: string): AgentInputItem[] {
  return [
    {
      role: 'user',
      content: [{ type: 'input_text', text }],
    } satisfies AgentInputItem,
  ];
}

function toGroundedUserAgentInput(
  text: string,
  chunks: RetrievedChunk[],
): AgentInputItem[] {
  if (chunks.length === 0) {
    return toLatestUserAgentInput(text);
  }

  const context = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.documentName || 'Unknown document'} chunk ${chunk.chunkIndex} (score ${chunk.score.toFixed(3)}):\n${sanitizeTextValue(chunk.content)}`,
    )
    .join('\n\n');

  return toLatestUserAgentInput(
    [
      `Question:\n${text}`,
      'Retrieved document context:',
      context,
      'Answer the question directly using the retrieved context. If the context contains the answer, do not ask for more information.',
    ].join('\n\n'),
  );
}

function getAssistantText(
  stream: StreamedRunResult<AgentToolRuntimeContext, ChatAgent>,
): string {
  return typeof stream.finalOutput === 'string'
    ? stream.finalOutput.trim()
    : '';
}

function toCitationSnippet(value: string): string {
  const normalized = sanitizeTextValue(value).trim().replace(/\s+/g, ' ');
  if (normalized.length <= 280) {
    return normalized;
  }

  return `${normalized.slice(0, 279).trimEnd()}…`;
}

function sanitizeTextValue(value: string): string {
  return value.replace(/\u0000/g, ' ');
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
    const parsedResult = retrieveChunksToolResultSchema.safeParse(
      toolCall.result,
    );
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

function toFallbackAnswerFromChunks(
  question: string,
  chunks: RetrievedChunk[],
): string {
  const preferredTerms = question
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((term) => term.length > 3);

  for (const chunk of chunks) {
    const sentences = sanitizeTextValue(chunk.content)
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const matchingSentence = sentences.find((sentence) => {
      const normalizedSentence = sentence.toLowerCase();
      return preferredTerms.some((term) => normalizedSentence.includes(term));
    });

    if (matchingSentence) {
      return `${matchingSentence} [${chunk.documentName || 'document'} chunk ${chunk.chunkIndex}]`;
    }
  }

  const firstChunk = chunks[0];
  return firstChunk
    ? `${toCitationSnippet(firstChunk.content)} [${firstChunk.documentName || 'document'} chunk ${firstChunk.chunkIndex}]`
    : 'I could not find relevant document context for that question.';
}

function toAssistantCitationsFromChunks(
  chunks: RetrievedChunk[],
): AssistantCitation[] {
  const seen = new Set<string>();

  return chunks.flatMap((chunk) => {
    const key = `${chunk.documentId}:${chunk.id}`;
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [
      {
        chunkId: chunk.id,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
        snippet: toCitationSnippet(chunk.content),
      },
    ];
  });
}

function createUiMessageStreamResponse(
  text: string,
  conversationId: string,
): Response {
  const encoder = new TextEncoder();
  const messageId = `message-${crypto.randomUUID()}`;
  const textId = `text-${crypto.randomUUID()}`;
  const events = [
    { type: 'start', messageId },
    { type: 'start-step' },
    { type: 'text-start', id: textId },
    { type: 'text-delta', id: textId, delta: text },
    { type: 'text-end', id: textId },
    { type: 'finish-step' },
    { type: 'finish', finishReason: 'stop' },
  ];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
      'x-accel-buffering': 'no',
      'x-conversation-id': conversationId,
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  });
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
    return (
      this.dependencies.streamResponseFactory ??
      createAiSdkUiMessageStreamResponse
    );
  }

  private get retrievalService(): Pick<N8nRetrievalService, 'retrieve'> {
    return this.dependencies.retrievalService ?? new N8nRetrievalService();
  }

  private shouldPrefetchRetrieval(): boolean {
    return Boolean(
      this.dependencies.retrievalService ||
      (env.openai.apiUrl && !isHostedOpenAiApiUrl(env.openai.apiUrl)),
    );
  }

  private async prefetchRetrievedChunks(input: {
    query: string;
    conversationId: string;
    requestId: string;
  }): Promise<RetrievedChunk[]> {
    if (!this.shouldPrefetchRetrieval()) {
      return [];
    }

    try {
      return await this.retrievalService.retrieve({
        query: input.query,
        conversationId: input.conversationId,
        documentIds: [],
        topK: 5,
        requestId: input.requestId,
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          conversationId: input.conversationId,
          requestId: input.requestId,
        },
        'Pre-retrieval for chat grounding failed.',
      );
      return [];
    }
  }

  private shouldUseLocalGroundedAnswer(chunks: RetrievedChunk[]): boolean {
    return (
      chunks.length > 0 &&
      Boolean(env.openai.apiUrl && !isHostedOpenAiApiUrl(env.openai.apiUrl))
    );
  }

  private async createLocalGroundedAnswer(input: {
    question: string;
    chunks: RetrievedChunk[];
    model: string;
  }): Promise<string> {
    const context = input.chunks
      .map(
        (chunk, index) => `[${index + 1}] ${sanitizeTextValue(chunk.content)}`,
      )
      .join('\n\n');
    const baseUrl = normalizeOpenAiChatCompletionsBaseUrl(env.openai.apiUrl, {
      docker: process.env.LOCALRAG_DOCKER === 'true',
    });

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          stream: false,
          messages: [
            {
              role: 'system',
              content:
                'Answer the user question using only the retrieved document context. If the answer is present, answer directly and concisely.',
            },
            {
              role: 'user',
              content: `Question: ${input.question}\n\nRetrieved context:\n${context}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Local chat completion failed with status ${response.status}.`,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const answer = payload.choices?.[0]?.message?.content;

      if (typeof answer === 'string' && answer.trim().length > 0) {
        return answer.trim();
      }
    } catch (error) {
      logger.warn({ err: error }, 'Local grounded answer generation failed.');
    }

    return toFallbackAnswerFromChunks(input.question, input.chunks);
  }

  private async syncConversationSearchText(
    db:
      | Pick<ChatDb, 'conversation' | 'message'>
      | Pick<ChatTransactionDb, 'conversation' | 'message'>,
    conversationId: string,
  ) {
    const messages = await db.message.findMany({
      where: {
        conversationId,
        role: {
          in: [MessageRole.USER, MessageRole.ASSISTANT],
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        content: true,
      },
    });

    await db.conversation.update({
      where: { id: conversationId },
      data: {
        searchText: buildSearchText(messages.map((message) => message.content)),
      },
    });
  }

  async streamChat(input: StreamChatInput): Promise<Response> {
    if (input.messages.some((message) => message.role === 'system')) {
      throw new AppError(
        'BAD_REQUEST',
        'System messages must be defined server-side.',
      );
    }

    const latestUserMessage = getLatestSubmittedUserMessage(input.messages);
    const latestUserText = latestUserMessage
      ? extractMessageText(latestUserMessage).trim()
      : '';
    if (!latestUserText) {
      throw new AppError(
        'BAD_REQUEST',
        'The latest submitted message must be a non-empty user message.',
      );
    }
    const selectedAgent = await this.resolveAgent(
      input.userId,
      input.activeAgentName,
    );
    const { conversation, userMessage, agentRun } = await this.db.$transaction(
      async (transaction: ChatTransactionDb) => {
        const conversation = await this.ensureConversation(transaction, {
          userId: input.userId,
          conversationId: input.conversationId,
          latestUserText,
          requestId: input.requestId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
        });

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
        await this.syncConversationSearchText(transaction, conversation.id);
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
            model:
              typeof selectedAgent.model === 'string'
                ? selectedAgent.model
                : env.openai.model,
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
              model:
                typeof selectedAgent.model === 'string'
                  ? selectedAgent.model
                  : env.openai.model,
              provider: 'openai',
              userMessageId: userMessage.id,
            }),
          },
        });

        return { conversation, userMessage, agentRun };
      },
    );
    const prefetchedChunks = await this.prefetchRetrievedChunks({
      query: latestUserText,
      conversationId: conversation.id,
      requestId: input.requestId,
    });
    if (this.shouldUseLocalGroundedAnswer(prefetchedChunks)) {
      const model =
        typeof selectedAgent.model === 'string'
          ? selectedAgent.model
          : env.openai.model;
      const assistantText = await this.createLocalGroundedAnswer({
        question: latestUserText,
        chunks: prefetchedChunks,
        model,
      });
      const citations = toAssistantCitationsFromChunks(prefetchedChunks);

      await this.db.$transaction(async (transaction) => {
        await transaction.message.create({
          data: {
            conversationId: conversation.id,
            role: MessageRole.ASSISTANT,
            content: assistantText,
            citations: citations.length > 0 ? citations : Prisma.JsonNull,
            metadata: {
              activeAgentName: selectedAgent.name,
              agent: selectedAgent.name,
              model,
              requestId: input.requestId,
              agentRunId: agentRun.id,
              groundingMode: 'prefetch',
            },
          },
        });
        await transaction.agentRun.update({
          where: { id: agentRun.id },
          data: {
            status: AgentRunStatus.COMPLETED,
            completedAt: new Date(),
            metadata: {
              activeAgentName: selectedAgent.name,
              requestId: input.requestId,
              userMessageId: userMessage.id,
              groundingMode: 'prefetch',
            },
          },
        });
        await this.syncConversationSearchText(transaction, conversation.id);
      });

      return createUiMessageStreamResponse(assistantText, conversation.id);
    }
    const agentInput = toGroundedUserAgentInput(
      latestUserText,
      prefetchedChunks,
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
              },
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                name: true,
                status: true,
                result: true,
                errorMessage: true,
              },
            });
            const citations = extractAssistantCitations(
              assistantCitations.filter(
                (toolCall) =>
                  toolCall.name === 'retrieve_chunks' &&
                  toolCall.status === 'COMPLETED',
              ),
            );
            const publicToolCalls = sanitizePublicToolCalls(assistantCitations);
            const model =
              typeof selectedAgent.model === 'string'
                ? selectedAgent.model
                : env.openai.model;
            const activeAgentName =
              stream.activeAgent?.name ?? selectedAgent.name;

            if (assistantText) {
              await transaction.message.create({
                data: {
                  conversationId: conversation.id,
                  role: MessageRole.ASSISTANT,
                  content: assistantText,
                  citations: citations.length > 0 ? citations : Prisma.JsonNull,
                  toolCalls:
                    publicToolCalls.length > 0
                      ? publicToolCalls
                      : Prisma.JsonNull,
                  metadata: {
                    activeAgentName,
                    agent: selectedAgent.name,
                    model,
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
                  activeAgentName:
                    stream.activeAgent?.name ?? selectedAgent.name,
                  requestId: input.requestId,
                  lastResponseId: stream.lastResponseId,
                  userMessageId: userMessage.id,
                },
              },
            });
            await this.syncConversationSearchText(transaction, conversation.id);
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
                errorMessage:
                  error instanceof Error
                    ? error.message
                    : 'An unexpected stream failure occurred.',
                userMessageId: userMessage.id,
              },
            },
          });
        });

      const response = this.streamResponseFactory(stream);
      response.headers.set('x-conversation-id', conversation.id);
      return response;
    } catch (error) {
      await this.db.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.FAILED,
          completedAt: new Date(),
          metadata: {
            activeAgentName: selectedAgent.name,
            requestId: input.requestId,
            errorMessage:
              error instanceof Error
                ? error.message
                : 'An unexpected chat failure occurred.',
            userMessageId: userMessage.id,
          },
        },
      });
      if (error instanceof AppError) {
        throw withConversationHeader(error, conversation.id);
      }

      throw new AppError(
        'INTERNAL_ERROR',
        'Unable to start chat stream.',
        undefined,
        {
          'x-conversation-id': conversation.id,
        },
      );
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
          metadata: setConversationTitleSource(null, 'auto'),
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

    const titleSource = getConversationTitleSource(conversation.metadata);
    const isAutoTitle =
      titleSource === 'auto' ||
      (titleSource === null && conversation.title === AUTO_TITLE_PLACEHOLDER);

    if (isAutoTitle && conversation.title === AUTO_TITLE_PLACEHOLDER) {
      const updatedConversation = await transaction.conversation.update({
        where: { id: conversation.id },
        data: {
          title: derivedTitle,
          metadata: setConversationTitleSource(conversation.metadata, 'auto'),
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

  private async resolveAgent(
    userId: string,
    activeAgentName?: string,
  ): Promise<ChatAgent> {
    const requestedAgentName = activeAgentName ?? defaultAgentName;
    const baseAgent = agentRegistry.get(requestedAgentName) as
      ChatAgent | undefined;

    if (!baseAgent) {
      throw new AppError('BAD_REQUEST', 'Unknown active agent.');
    }

    const settings = await this.settingsService.getForUser(userId);
    return baseAgent.clone({
      model: settings.model || env.openai.model,
    });
  }
}
