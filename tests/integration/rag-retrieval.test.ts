import { describe, expect, it, test, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { corpusQuestions } from '@/tests/fixtures/corpus-questions';

const liveCorpusEnabled = process.env.LOCALRAG_LIVE_CORPUS_TESTS === '1';
const describeLive = liveCorpusEnabled ? describe : describe.skip;

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

describeLive('N8nRetrievalService live corpus validation', () => {
  it('returns grounded chunks for each seeded corpus question', async () => {
    const n8nReady = await canReach(process.env.N8N_BASE_URL ? `${process.env.N8N_BASE_URL.replace(/\/$/, '')}/healthz` : undefined);
    const qdrantReady = await canReach(process.env.QDRANT_URL ? `${process.env.QDRANT_URL.replace(/\/$/, '')}/collections` : undefined);

    if (!n8nReady || !qdrantReady) {
      console.warn('[rag-retrieval.test] skipping live corpus retrieval because n8n or Qdrant is unavailable.');
      return;
    }

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
