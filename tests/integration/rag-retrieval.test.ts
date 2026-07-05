import { describe, expect, it, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { corpusQuestions } from '@/tests/fixtures/corpus-questions';
import { summarizeLiveCorpusPreflight } from '@/tests/integration/support/live-corpus-preflight';
import { hasUsableLiveOpenAiKey } from '@/tests/support/live-openai-key';

const liveCorpusEnabled = process.env.LOCALRAG_LIVE_CORPUS_TESTS === '1';

async function canReach(url: string | undefined) {
  if (!url) {
    return false;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
    });

    return response.ok;
  } catch {
    return false;
  }
}

async function canQueryDatabase(connectionString: string | undefined) {
  if (!connectionString) {
    return false;
  }

  try {
    const { prisma } = await import('@/lib/db/prisma');
    await prisma.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

const liveCorpusDependencyReadiness = liveCorpusEnabled
  ? await (async () => {
      const [n8nReady, qdrantReady, databaseReady] = await Promise.all([
        canReach(process.env.N8N_BASE_URL ? `${process.env.N8N_BASE_URL.replace(/\/$/, '')}/healthz` : undefined),
        canReach(process.env.QDRANT_URL ? `${process.env.QDRANT_URL.replace(/\/$/, '')}/collections` : undefined),
        canQueryDatabase(process.env.DATABASE_URL),
      ]);

      return {
        n8nReady,
        qdrantReady,
        databaseReady,
        openAiReady: hasUsableLiveOpenAiKey(process.env.OPENAI_API_KEY),
      };
    })()
  : undefined;

const liveCorpusPreflight = summarizeLiveCorpusPreflight({
  liveCorpusEnabled,
  dependencyReadiness: liveCorpusDependencyReadiness,
});
const describeLive = liveCorpusPreflight.shouldRun ? describe : describe.skip;

describeLive('N8nRetrievalService live corpus validation', () => {
  it('returns grounded chunks for each seeded corpus question', async () => {
    const [{ N8nRetrievalService }, { seedCorpus }] = await Promise.all([
      import('@/lib/n8n/retrieval'),
      import('@/scripts/seed-corpus'),
    ]);

    await seedCorpus();

    const retrievalService = new N8nRetrievalService();

    for (const corpusQuestion of corpusQuestions) {
      const chunks = await retrievalService.retrieve({
        query: corpusQuestion.question,
        documentIds: [],
        topK: 5,
        requestId: `rag-retrieval-${corpusQuestion.fileName}`,
      });

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.some((chunk) => chunk.documentName.includes(corpusQuestion.fileName))).toBe(true);

      for (const chunk of chunks) {
        expect(typeof chunk.score).toBe('number');
        expect(Number.isFinite(chunk.score)).toBe(true);
        expect(chunk.content.trim().length).toBeGreaterThan(0);
      }
    }
  }, 180_000);
});
