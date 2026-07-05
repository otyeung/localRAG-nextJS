import { expect, test } from '@playwright/test';

import { corpusQuestions } from '@/tests/fixtures/corpus-questions';

const liveCorpusEnabled = process.env.LOCALRAG_LIVE_CORPUS_TESTS === '1';
const liveOpenAiConfigured =
  typeof process.env.OPENAI_API_KEY === 'string' &&
  process.env.OPENAI_API_KEY.trim().length > 0 &&
  process.env.OPENAI_API_KEY !== 'sk-test';

test.describe.configure({ mode: 'serial' });

test('answers seeded corpus questions with citations and survives reload', async ({ page, request }) => {
  test.skip(!liveCorpusEnabled || !liveOpenAiConfigured, 'Set LOCALRAG_LIVE_CORPUS_TESTS=1 with a live OPENAI_API_KEY to run corpus RAG E2E validation.');
  test.slow();

  const healthResponse = await request.get('/api/health');
  if (!healthResponse.ok() && healthResponse.status() !== 503) {
    test.skip(true, 'Live application health endpoint is unavailable.');
  }
  const healthPayload = (await healthResponse.json()) as {
    data?: {
      checks?: Array<{
        name?: string;
        status?: string;
      }>;
    };
  };
  const checkStatuses = new Map(
    (healthPayload.data?.checks ?? []).map((check) => [check.name ?? '', check.status ?? 'unknown']),
  );
  const unavailableDependencies = ['database', 'n8n', 'qdrant', 'openai'].filter(
    (dependency) => checkStatuses.get(dependency) !== 'healthy',
  );
  if (unavailableDependencies.length > 0) {
    test.skip(true, `Required live dependencies are unavailable: ${unavailableDependencies.join(', ')}.`);
  }

  const documentsResponse = await request.get('/api/documents?page=1&pageSize=100');
  if (!documentsResponse.ok()) {
    test.skip(true, 'Live document APIs are unavailable for corpus validation.');
  }

  const documentsPayload = (await documentsResponse.json()) as {
    data?: { items?: Array<{ originalFilename?: string }> };
  };
  const seededFiles = new Set((documentsPayload.data?.items ?? []).map((document) => document.originalFilename).filter(Boolean));
  const missingFiles = corpusQuestions.filter((corpusQuestion) => !seededFiles.has(corpusQuestion.fileName));
  if (missingFiles.length > 0) {
    test.skip(true, `Seeded corpus files are missing: ${missingFiles.map((file) => file.fileName).join(', ')}.`);
  }

  await page.goto('/');
  await page.getByRole('button', { name: 'New Chat' }).click();
  await expect(page.getByRole('textbox', { name: 'Message input' })).toBeVisible();

  for (const corpusQuestion of corpusQuestions) {
    const requestPromise = page.waitForResponse(
      (response) => response.url().includes('/api/chat') && response.request().method() === 'POST',
      { timeout: 120_000 },
    );

    await page.getByRole('textbox', { name: 'Message input' }).fill(corpusQuestion.question);
    await page.getByRole('button', { name: 'Send message' }).click();

    await requestPromise;
    await expect(page.getByText('Streaming answer')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Ready')).toBeVisible({ timeout: 180_000 });
    await expect(page.getByRole('button', { name: 'Stop generation' })).toBeDisabled();

    for (const fragment of corpusQuestion.requiredAnswerFragments) {
      await expect(page.getByText(new RegExp(fragment, 'i'))).toBeVisible({ timeout: 120_000 });
    }

    await expect(page.getByText('Citations')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(corpusQuestion.fileName)).toBeVisible({ timeout: 120_000 });
  }

  const persistedFragment = corpusQuestions.at(-1)?.requiredAnswerFragments[0] ?? 'cargo';
  await page.reload();
  await expect(page.getByText(new RegExp(persistedFragment, 'i'))).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Citations')).toBeVisible({ timeout: 120_000 });
});
