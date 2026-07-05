import type { Prisma } from '@prisma/client';

export const AUTO_TITLE_PLACEHOLDER = 'New Chat';

export type ConversationTitleSource = 'auto' | 'user';

type JsonObject = Prisma.InputJsonObject;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getConversationTitleSource(metadata: unknown): ConversationTitleSource | null {
  if (!isJsonObject(metadata)) {
    return null;
  }

  return metadata.titleSource === 'auto' || metadata.titleSource === 'user' ? metadata.titleSource : null;
}

export function setConversationTitleSource(
  metadata: unknown,
  titleSource: ConversationTitleSource,
): JsonObject {
  return {
    ...(isJsonObject(metadata) ? metadata : {}),
    titleSource,
  };
}
