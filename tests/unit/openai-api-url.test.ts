import { describe, expect, it } from 'vitest';

import {
  isHostedOpenAiApiUrl,
  normalizeOpenAiChatCompletionsBaseUrl,
} from '@/lib/openai/api-url';

describe('OpenAI API URL helpers', () => {
  it('normalizes an Ollama native base URL to the OpenAI-compatible chat completions base URL', () => {
    expect(
      normalizeOpenAiChatCompletionsBaseUrl('http://localhost:11434'),
    ).toBe('http://localhost:11434/v1');
  });

  it('rewrites host localhost for Docker containers before appending the OpenAI-compatible path', () => {
    expect(
      normalizeOpenAiChatCompletionsBaseUrl('http://localhost:11434', {
        docker: true,
      }),
    ).toBe('http://host.docker.internal:11434/v1');
  });

  it('preserves explicit v1 OpenAI-compatible base URLs', () => {
    expect(
      normalizeOpenAiChatCompletionsBaseUrl('http://localhost:11434/v1'),
    ).toBe('http://localhost:11434/v1');
  });

  it('detects the hosted OpenAI API URL separately from local-compatible endpoints', () => {
    expect(isHostedOpenAiApiUrl('https://api.openai.com/v1')).toBe(true);
    expect(isHostedOpenAiApiUrl('http://localhost:11434')).toBe(false);
  });
});
