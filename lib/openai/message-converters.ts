import type { AgentInputItem } from '@openai/agents';
import type { UIMessage } from 'ai';

type LegacyContentPart = {
  type?: string;
  text?: string;
  content?: string;
};

type LegacyMessage = UIMessage & {
  content?: unknown;
};

function collectTextFromParts(parts: Array<{ type?: string; text?: string }> | undefined): string {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

function collectTextFromLegacyContent(content: LegacyMessage['content']): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part.trim();
        }

        if (part && typeof part === 'object') {
          const candidate = part as LegacyContentPart;

          if (
            candidate.type === 'text' ||
            candidate.type === 'input_text' ||
            candidate.type === 'output_text'
          ) {
            return candidate.text?.trim() ?? '';
          }

          return candidate.content?.trim() ?? '';
        }

        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (content && typeof content === 'object') {
    const candidate = content as LegacyContentPart;
    return candidate.text?.trim() ?? candidate.content?.trim() ?? '';
  }

  return '';
}

function getMessageText(message: LegacyMessage): string {
  const fromParts = collectTextFromParts(message.parts as Array<{ type?: string; text?: string }> | undefined);
  if (fromParts.length > 0) {
    return fromParts;
  }

  return collectTextFromLegacyContent(message.content);
}

export function toAgentInput(messages: UIMessage[]): AgentInputItem[] {
  const items: AgentInputItem[] = [];

  for (const message of messages) {
    const text = getMessageText(message as LegacyMessage).trim();

    if (!text) {
      continue;
    }

    switch (message.role) {
      case 'system':
        items.push({
          role: 'system',
          content: text,
        } satisfies AgentInputItem);
        break;
      case 'assistant':
        items.push({
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text }],
        } satisfies AgentInputItem);
        break;
      case 'user':
      default:
        items.push({
          role: 'user',
          content: [{ type: 'input_text', text }],
        } satisfies AgentInputItem);
        break;
    }
  }

  return items;
}
