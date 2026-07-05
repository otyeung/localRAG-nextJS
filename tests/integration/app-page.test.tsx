import { describe, expect, it } from 'vitest';

import { siteDescription, siteTitle } from '@/app/site-content';

describe('bootstrap home page', () => {
  it('publishes the site title and description used by the shell', () => {
    expect(siteTitle).toBe('LocalRAG');
    expect(siteDescription).toBe('Enterprise RAG foundation');
  });
});
