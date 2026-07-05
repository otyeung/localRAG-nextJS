import { describe, expect, it } from 'vitest';

import { summarizeLiveCorpusPreflight } from '@/tests/integration/support/live-corpus-preflight';

describe('summarizeLiveCorpusPreflight', () => {
  it('returns a skipped status with unavailable dependency names when live corpus tests are enabled', () => {
    expect(
      summarizeLiveCorpusPreflight({
        liveCorpusEnabled: true,
        dependencyReadiness: {
          n8nReady: false,
          qdrantReady: true,
          databaseReady: false,
          openAiReady: true,
        },
      }),
    ).toEqual({
      shouldRun: false,
      skipReason: 'Required live dependencies are unavailable: n8n, database.',
    });
  });

  it('treats a missing or dummy openai key as an unavailable live dependency', () => {
    expect(
      summarizeLiveCorpusPreflight({
        liveCorpusEnabled: true,
        dependencyReadiness: {
          n8nReady: true,
          qdrantReady: true,
          databaseReady: true,
          openAiReady: false,
        },
      }),
    ).toEqual({
      shouldRun: false,
      skipReason: 'Required live dependencies are unavailable: openai.',
    });
  });

  it('allows the live corpus suite to run when every dependency is healthy', () => {
    expect(
      summarizeLiveCorpusPreflight({
        liveCorpusEnabled: true,
        dependencyReadiness: {
          n8nReady: true,
          qdrantReady: true,
          databaseReady: true,
          openAiReady: true,
        },
      }),
    ).toEqual({
      shouldRun: true,
      skipReason: null,
    });
  });
});
