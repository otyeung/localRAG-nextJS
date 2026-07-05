import { describe, expect, it } from 'vitest';

import { hasUsableLiveOpenAiKey } from '@/tests/support/live-openai-key';

describe('hasUsableLiveOpenAiKey', () => {
  it('rejects missing or dummy live corpus keys', () => {
    expect(hasUsableLiveOpenAiKey(undefined)).toBe(false);
    expect(hasUsableLiveOpenAiKey('')).toBe(false);
    expect(hasUsableLiveOpenAiKey('   ')).toBe(false);
    expect(hasUsableLiveOpenAiKey('sk-test')).toBe(false);
    expect(hasUsableLiveOpenAiKey('sk-test-123')).toBe(false);
    expect(hasUsableLiveOpenAiKey('sk-playwright')).toBe(false);
    expect(hasUsableLiveOpenAiKey('sk-playwright-123')).toBe(false);
  });

  it('accepts non-placeholder keys', () => {
    expect(hasUsableLiveOpenAiKey('sk-live-real-key')).toBe(true);
  });
});
