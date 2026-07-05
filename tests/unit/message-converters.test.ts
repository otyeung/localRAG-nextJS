import type { UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';

import { toAgentInput } from '@/lib/openai/message-converters';

describe('toAgentInput', () => {
  it('converts UI text parts into agent input', () => {
    const messages: UIMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'What is the cargo capacity of Cymbal Starlight?' }],
      },
    ];

    const input = toAgentInput(messages);

    expect(input).toHaveLength(1);
    expect(JSON.stringify(input)).toContain('Cymbal Starlight');
  });

  it('supports assistant and system roles', () => {
    const messages: Array<UIMessage | (UIMessage & { content?: string })> = [
      {
        id: 'system-1',
        role: 'system',
        parts: [{ type: 'text', text: 'Stay concise.' }],
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Here is a concise answer.' }],
      },
    ];

    const input = toAgentInput(messages);

    expect(input).toEqual([
      {
        role: 'system',
        content: 'Stay concise.',
      },
      {
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Here is a concise answer.' }],
      },
    ]);
  });

  it('falls back to legacy content and drops empty messages', () => {
    const messages = [
      {
        id: 'legacy-1',
        role: 'user',
        parts: [],
        content: 'Use the older content field',
      },
      {
        id: 'empty-1',
        role: 'assistant',
        parts: [{ type: 'text', text: '   ' }],
      },
    ] as Array<UIMessage & { content?: string }>;

    const input = toAgentInput(messages);

    expect(input).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Use the older content field' }],
      },
    ]);
  });
});
