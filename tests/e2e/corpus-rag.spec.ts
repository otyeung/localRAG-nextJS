import { expect, test, type Page, type Route } from '@playwright/test';

import { corpusQuestions } from '@/tests/fixtures/corpus-questions';

const liveCorpusEnabled = process.env.LOCALRAG_LIVE_CORPUS_TESTS === '1';
const liveOpenAiConfigured =
  typeof process.env.OPENAI_API_KEY === 'string' &&
  process.env.OPENAI_API_KEY.trim().length > 0 &&
  process.env.OPENAI_API_KEY !== 'sk-test';

test.describe.configure({ mode: 'serial' });

type PersistedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Array<{ documentId: string; documentName: string }> | null;
  toolCalls: null;
  metadata: { activeAgentName?: string; model?: string } | null;
  createdAt: string;
  updatedAt: string;
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

function toSseBody(chunks: unknown[]) {
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
}

async function mockShellApis(page: Page, getMessages: () => PersistedMessage[]) {
  await page.route('**/api/health', (route) =>
    json(route, {
      status: 'healthy',
      checkedAt: '2026-07-06T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 120,
      checks: [
        { name: 'app', status: 'healthy', message: 'Application healthy.', latencyMs: 2 },
        { name: 'database', status: 'healthy', message: 'Database healthy.', latencyMs: 4 },
      ],
    }),
  );

  await page.route('**/api/conversations**', (route) =>
    json(route, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 30,
    }),
  );

  await page.route('**/api/messages**', (route) =>
    json(route, {
      items: getMessages(),
      total: getMessages().length,
      page: 1,
      pageSize: 100,
      order: 'asc',
    }),
  );

  await page.route('**/api/documents**', (route) =>
    json(route, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 40,
    }),
  );

  await page.route('**/api/workflows**', (route) =>
    json(route, {
      items: [],
      total: 0,
    }),
  );

  await page.route('**/api/uploads', (route) => json(route, []));

  await page.route('**/api/settings', (route) =>
    json(route, {
      theme: 'system',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: true,
    }),
  );
}

async function installMockChatTransport(page: Page) {
  const finalResponseBody = toSseBody([
    { type: 'start', messageId: 'assistant_retry_1' },
    { type: 'start-step' },
    { type: 'text-start', id: 'text_retry_1' },
    {
      type: 'text-delta',
      id: 'text_retry_1',
      delta: 'Retry completed with a grounded answer about cargo capacity.',
    },
    {
      type: 'source-document',
      sourceId: 'document_seeded_1',
      mediaType: 'application/pdf',
      title: 'cymbal-starlight-2024.pdf',
      filename: 'cymbal-starlight-2024.pdf',
    },
    { type: 'text-end', id: 'text_retry_1' },
    { type: 'finish-step' },
    {
      type: 'finish',
      finishReason: 'stop',
      messageMetadata: {
        activeAgentName: 'DocumentAgent',
        model: 'gpt-4.1-mini',
      },
    },
  ]);

  await page.addInitScript(({ responseBody }) => {
    const originalFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const state = {
      totalRequests: 0,
      abortedRequests: 0,
      completedRequests: 0,
    };

    Object.assign(window, {
      __chatMockState: state,
    });

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : null;
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : request?.url ?? String(input);

      if (!url.includes('/api/chat')) {
        return originalFetch(input, init);
      }

      state.totalRequests += 1;
      const signal = init?.signal ?? request?.signal;

      if (state.totalRequests === 1) {
        return new Promise<Response>((resolve, reject) => {
          const onAbort = () => {
            state.abortedRequests += 1;
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          };

          if (signal?.aborted) {
            onAbort();
            return;
          }

          signal?.addEventListener('abort', onAbort, { once: true });
          void resolve;
        });
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(responseBody));
          controller.close();
          state.completedRequests += 1;
        },
        cancel() {
          state.abortedRequests += 1;
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-vercel-ai-ui-message-stream': 'v1',
          'x-conversation-id': 'conversation_retry_1',
        },
      });
    };
  }, { responseBody: finalResponseBody });
}

async function findSeededDocumentCard(page: Page, fileName: string) {
  const searchInput = page.getByPlaceholder('Search documents');
  await searchInput.fill(fileName);
  const documentCard = page.getByRole('article', { name: `Document ${fileName}` });
  await expect(documentCard).toBeVisible({ timeout: 120_000 });
  return documentCard;
}

test('stops a pending generation and retries the latest response with grounded output', async ({ page }) => {
  let persistedMessages: PersistedMessage[] = [];
  await mockShellApis(page, () => persistedMessages);
  await installMockChatTransport(page);
  await page.goto('/');

  await page.getByRole('textbox', { name: 'Message input' }).fill('What is the cargo capacity of Cymbal Starlight?');
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect(page.getByTestId('stop-generation')).toBeEnabled();
  await page.getByTestId('stop-generation').click();

  await page.waitForFunction(() => {
    const state = (window as typeof window & {
      __chatMockState?: { abortedRequests: number };
    }).__chatMockState;

    return state?.abortedRequests === 1;
  });
  await expect(page.getByTestId('stop-generation')).toBeDisabled();
  await expect(page.getByTestId('retry-latest-response')).toBeEnabled();

  persistedMessages = [
    {
      id: 'message_user_retry_1',
      role: 'user',
      content: 'What is the cargo capacity of Cymbal Starlight?',
      citations: null,
      toolCalls: null,
      metadata: null,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
    },
    {
      id: 'message_assistant_retry_1',
      role: 'assistant',
      content: 'Retry completed with a grounded answer about cargo capacity.',
      citations: [
        {
          documentId: 'document_seeded_1',
          documentName: 'cymbal-starlight-2024.pdf',
        },
      ],
      toolCalls: null,
      metadata: {
        activeAgentName: 'DocumentAgent',
        model: 'gpt-4.1-mini',
      },
      createdAt: '2026-07-06T00:00:05.000Z',
      updatedAt: '2026-07-06T00:00:05.000Z',
    },
  ];

  await page.getByTestId('retry-latest-response').click();

  const assistantMessage = page.getByRole('article').filter({
    has: page.getByText('Retry completed with a grounded answer about cargo capacity.'),
  });
  await expect(assistantMessage).toBeVisible();
  await expect(assistantMessage.getByText('Citations', { exact: true })).toBeVisible();
  await expect(assistantMessage.getByText('cymbal-starlight-2024.pdf')).toBeVisible();
  await page.waitForFunction(() => {
    const state = (window as typeof window & {
      __chatMockState?: { totalRequests: number; abortedRequests: number; completedRequests: number };
    }).__chatMockState;

    return state?.totalRequests === 2 && state.abortedRequests === 1 && state.completedRequests === 1;
  });
});

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
  await page.getByRole('button', { name: 'Knowledge Base' }).click();

  for (const corpusQuestion of corpusQuestions) {
    const documentCard = await findSeededDocumentCard(page, corpusQuestion.fileName);
    await expect(documentCard.getByText(corpusQuestion.fileName)).toBeVisible({ timeout: 120_000 });
    await expect(documentCard.getByText('READY')).toBeVisible({ timeout: 120_000 });
    await expect(documentCard.getByText('Embedding status')).toBeVisible({ timeout: 120_000 });
    await expect(documentCard.getByText('Indexed')).toBeVisible({ timeout: 120_000 });
    await expect(documentCard.getByText('Chunk count')).toBeVisible({ timeout: 120_000 });
    await expect(documentCard.getByText(/\d+ chunks?/)).toBeVisible({ timeout: 120_000 });
    await expect(documentCard.getByText('Workflow status')).toBeVisible({ timeout: 120_000 });
    await expect(
      documentCard.getByText(/SUCCESS|RUNNING|WAITING|QUEUED|Workflow pending|Workflow unavailable|Checking workflow/i),
    ).toBeVisible({ timeout: 120_000 });
  }

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

    const latestAssistantMessage = page.getByRole('article').filter({
      has: page.getByText(new RegExp(corpusQuestion.requiredAnswerFragments[0] ?? corpusQuestion.fileName, 'i')).last(),
    });
    await expect(latestAssistantMessage.getByText('Citations', { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(latestAssistantMessage.getByText(corpusQuestion.fileName)).toBeVisible({ timeout: 120_000 });
  }

  const persistedFragment = corpusQuestions.at(-1)?.requiredAnswerFragments[0] ?? 'cargo';
  await page.reload();
  await expect(page.getByText(new RegExp(persistedFragment, 'i'))).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Citations', { exact: true })).toBeVisible({ timeout: 120_000 });
});
