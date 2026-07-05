import type { AgentInputItem } from '@openai/agents';
import type { AppUiMessageLike } from '@/lib/openai/ui-messages';
import { extractMessageText } from '@/lib/openai/ui-messages';

export function toAgentInput(messages: AppUiMessageLike[]): AgentInputItem[] {
  const items: AgentInputItem[] = [];

  for (const message of messages) {
    const text = extractMessageText(message).trim();

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
