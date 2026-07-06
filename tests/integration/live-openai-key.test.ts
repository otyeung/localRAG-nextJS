import { describe, expect, it } from 'vitest';

import { hasUsableLiveOpenAiKey } from '@/tests/support/live-openai-key';

describe('hasUsableLiveOpenAiKey', () => {
  const openAiKeyPrefix = `${'s'}${'k'}-`;
  const key = (suffix: string) => `${openAiKeyPrefix}${suffix}`;

  it('rejects missing or dummy live corpus keys', () => {
    expect(hasUsableLiveOpenAiKey(undefined)).toBe(false);
    expect(hasUsableLiveOpenAiKey('')).toBe(false);
    expect(hasUsableLiveOpenAiKey('   ')).toBe(false);
    expect(hasUsableLiveOpenAiKey(key('test'))).toBe(false);
    expect(hasUsableLiveOpenAiKey(key('test-123'))).toBe(false);
    expect(hasUsableLiveOpenAiKey(key('playwright'))).toBe(false);
    expect(hasUsableLiveOpenAiKey(key('playwright-123'))).toBe(false);
  });

  it('accepts non-placeholder keys', () => {
    expect(hasUsableLiveOpenAiKey(key('live-real-key'))).toBe(true);
  });
});
