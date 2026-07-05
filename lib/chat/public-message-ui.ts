import type { UIMessage } from 'ai';

type PersistedCitation = {
  documentId?: unknown;
  documentName?: unknown;
};

export type PublicMessageRecord = {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  toolCalls: unknown;
  createdAt: string;
  updatedAt: string;
};

export type ChatUiMessage = UIMessage<{
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

export function toChatUiMessage(message: PublicMessageRecord): ChatUiMessage {
  const parts: ChatUiMessage['parts'] = [];

  if (message.content.trim().length > 0) {
    parts.push({
      type: 'text',
      text: message.content,
    });
  }

  parts.push(...toCitationParts(message.citations));

  return {
    id: message.id,
    role: normalizeRole(message.role),
    parts,
    metadata: {
      createdAt: message.createdAt,
    },
  };
}

export function toChatUiMessages(messages: PublicMessageRecord[]): ChatUiMessage[] {
  return messages.map(toChatUiMessage);
}
