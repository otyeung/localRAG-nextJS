import type { UIMessage } from 'ai';

type PersistedCitation = {
  documentId?: unknown;
  documentName?: unknown;
};

type PersistedToolCall = {
  id?: unknown;
  name?: unknown;
  status?: unknown;
  errorMessage?: unknown;
};

export type PublicMessageRecord = {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  toolCalls: unknown;
  metadata?: PublicMessageMetadata | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicMessageMetadata = {
  model?: string;
  agent?: string;
  activeAgentName?: string;
};

export type PublicToolCallRecord = {
  id: string;
  name: string;
  status: 'STARTED' | 'COMPLETED' | 'FAILED';
  errorMessage?: string;
};

export type ChatUiMessage = UIMessage<{
  model?: string;
  agent?: string;
  activeAgentName?: string;
  createdAt?: string;
}>;

function normalizeRole(role: string): ChatUiMessage['role'] {
  const normalized = role.toLowerCase();

  if (normalized === 'assistant' || normalized === 'system') {
    return normalized;
  }

  return 'user';
}

function toCitationParts(citations: unknown): ChatUiMessage['parts'] {
  if (!Array.isArray(citations)) {
    return [];
  }

  return citations.flatMap((citation) => {
    if (!citation || typeof citation !== 'object') {
      return [];
    }

    const { documentId, documentName } = citation as PersistedCitation;
    if (typeof documentId !== 'string' || documentId.length === 0) {
      return [];
    }

    return [
      {
        type: 'source-document',
        sourceId: documentId,
        mediaType: 'text/plain',
        title: typeof documentName === 'string' && documentName.length > 0 ? documentName : documentId,
      } as const,
    ];
  });
}

function toToolParts(toolCalls: unknown): ChatUiMessage['parts'] {
  const safeToolCalls = sanitizePublicToolCalls(toolCalls);

  return safeToolCalls.map((toolCall) => {
    if (toolCall.status === 'FAILED' && toolCall.errorMessage) {
      return {
        type: 'dynamic-tool' as const,
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        state: 'output-error' as const,
        input: {},
        errorText: toolCall.errorMessage,
      };
    }

    if (toolCall.status === 'COMPLETED') {
      return {
        type: 'dynamic-tool' as const,
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        state: 'output-available' as const,
        input: {},
        output: {},
      };
    }

    return {
      type: 'dynamic-tool' as const,
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      state: 'input-available' as const,
      input: {},
    };
  });
}

export function sanitizePublicMessageMetadata(metadata: unknown): PublicMessageMetadata | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  const safeMetadata: PublicMessageMetadata = {};

  if (typeof record.model === 'string' && record.model.trim().length > 0) {
    safeMetadata.model = record.model;
  }

  if (typeof record.agent === 'string' && record.agent.trim().length > 0) {
    safeMetadata.agent = record.agent;
  }

  if (typeof record.activeAgentName === 'string' && record.activeAgentName.trim().length > 0) {
    safeMetadata.activeAgentName = record.activeAgentName;
  }

  return Object.keys(safeMetadata).length > 0 ? safeMetadata : null;
}

export function sanitizePublicToolCalls(toolCalls: unknown): PublicToolCallRecord[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls.flatMap((toolCall) => {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
      return [];
    }

    const record = toolCall as PersistedToolCall;
    if (typeof record.id !== 'string' || record.id.trim().length === 0) {
      return [];
    }
    if (typeof record.name !== 'string' || record.name.trim().length === 0) {
      return [];
    }
    if (record.status !== 'STARTED' && record.status !== 'COMPLETED' && record.status !== 'FAILED') {
      return [];
    }

    return [
      {
        id: record.id,
        name: record.name,
        status: record.status,
        ...(typeof record.errorMessage === 'string' && record.errorMessage.trim().length > 0
          ? { errorMessage: record.errorMessage }
          : {}),
      },
    ];
  });
}

export function toChatUiMessage(message: PublicMessageRecord): ChatUiMessage {
  const parts: ChatUiMessage['parts'] = [];
  const safeMetadata = sanitizePublicMessageMetadata(message.metadata);

  if (message.content.trim().length > 0) {
    parts.push({
      type: 'text',
      text: message.content,
    });
  }

  parts.push(...toToolParts(message.toolCalls));
  parts.push(...toCitationParts(message.citations));

  return {
    id: message.id,
    role: normalizeRole(message.role),
    parts,
    metadata: {
      ...(safeMetadata ?? {}),
      createdAt: message.createdAt,
    },
  };
}

export function toChatUiMessages(messages: PublicMessageRecord[]): ChatUiMessage[] {
  return messages.map(toChatUiMessage);
}
