import type { UIMessage } from 'ai';
import { z } from 'zod';

type LegacyContentPart = {
  type?: string;
  text?: string;
  content?: string;
};

export type AppUiTextPart = {
  type: 'text';
  text: string;
};

export type AppUiMessage = Pick<UIMessage, 'role'> & {
  id?: string;
  parts: AppUiTextPart[];
  content?: string;
};

export const appUiTextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string().trim().min(1, 'Message text must be non-empty.'),
});

export const appUiMessageSchema = z
  .object({
    id: z.string().optional(),
    role: z.enum(['system', 'user', 'assistant']),
    parts: z.array(appUiTextPartSchema),
    content: z.string().trim().min(1, 'Legacy message content must be non-empty.').optional(),
  })
  .superRefine((message, context) => {
    if (message.parts.length > 0 || message.content) {
      return;
    }

    context.addIssue({
      code: 'custom',
      path: ['parts'],
      message: 'Message must include at least one non-empty text part or legacy content.',
    });
  });

export type AppUiMessageLike = {
  role: 'system' | 'user' | 'assistant';
  id?: string;
  parts?: Array<{ type?: string; text?: string }>;
  content?: unknown;
};

function collectTextFromParts(parts: AppUiMessageLike['parts']): string {
  if (!Array.isArray(parts)) {
    return '';
  }

  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n');
}

function collectTextFromLegacyContent(content: AppUiMessageLike['content']): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part.trim();
        }

        if (!part || typeof part !== 'object') {
          return '';
        }

        const candidate = part as LegacyContentPart;
        if (
          candidate.type === 'text' ||
          candidate.type === 'input_text' ||
          candidate.type === 'output_text'
        ) {
          return candidate.text?.trim() ?? '';
        }

        return candidate.content?.trim() ?? '';
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

export function extractMessageText(message: AppUiMessageLike): string {
  const fromParts = collectTextFromParts(message.parts);
  if (fromParts.length > 0) {
    return fromParts;
  }

  return collectTextFromLegacyContent(message.content);
}
