import { expect, test, type Page, type Route } from '@playwright/test';

type ConversationRecord = {
  id: string;
  title: string;
  status: 'ACTIVE';
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview: string | null;
  activeAgentName: string | null;
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

async function mockConversationApis(page: Page) {
  let conversations: ConversationRecord[] = [
    {
      id: 'conversation_1',
      title: 'Roadmap review',
      status: 'ACTIVE',
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      messageCount: 2,
      lastMessagePreview: 'Summarize the roadmap milestones.',
      activeAgentName: 'GeneralAssistantAgent',
    },
    {
      id: 'conversation_2',
      title: 'Seeded corpus follow-up',
      status: 'ACTIVE',
      createdAt: '2026-07-05T23:55:00.000Z',
      updatedAt: '2026-07-05T23:55:00.000Z',
      messageCount: 1,
      lastMessagePreview: 'What does the corpus say?',
      activeAgentName: 'DocumentAgent',
    },
  ];

  await page.route('**/api/health', (route) =>
    json(route, {
      status: 'healthy',
      checkedAt: '2026-07-06T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 120,
      checks: [{ name: 'app', status: 'healthy', message: 'Application healthy.', latencyMs: 1 }],
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

  await page.route('**/api/uploads', (route) =>
    json(route, []),
  );

  await page.route('**/api/settings', (route) =>
    json(route, {
      theme: 'system',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: true,
    }),
  );

  await page.route('**/api/conversations**', async (route) => {
    if (route.request().method() === 'POST') {
      const created: ConversationRecord = {
        id: 'conversation_3',
        title: 'New Chat',
        status: 'ACTIVE',
        createdAt: '2026-07-06T00:05:00.000Z',
        updatedAt: '2026-07-06T00:05:00.000Z',
        messageCount: 0,
        lastMessagePreview: null,
        activeAgentName: null,
      };
      conversations = [created, ...conversations];
      await json(route, created, 201);
      return;
    }

    await json(route, {
      items: conversations,
      total: conversations.length,
      page: 1,
      pageSize: 30,
    });
  });

  await page.route('**/api/conversations/*', async (route) => {
    const url = new URL(route.request().url());
    const conversationId = url.pathname.split('/').pop() ?? '';

    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON() as { title: string };
      conversations = conversations.map((conversation) =>
        conversation.id === conversationId
          ? {
              ...conversation,
              title: payload.title,
              updatedAt: '2026-07-06T00:06:00.000Z',
            }
          : conversation,
      );
      await json(route, conversations.find((conversation) => conversation.id === conversationId));
      return;
    }

    if (route.request().method() === 'DELETE') {
      const removed = conversations.find((conversation) => conversation.id === conversationId)!;
      conversations = conversations.filter((conversation) => conversation.id !== conversationId);
      await json(route, removed);
      return;
    }

    await route.fallback();
  });

  await page.route('**/api/messages**', async (route) => {
    const url = new URL(route.request().url());
    const conversationId = url.searchParams.get('conversationId');

    const messageMap: Record<string, Array<Record<string, unknown>>> = {
      conversation_1: [
        {
          id: 'message_1',
          role: 'user',
          content: 'Summarize the roadmap milestones.',
          citations: null,
          toolCalls: null,
          metadata: null,
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:00:00.000Z',
        },
        {
          id: 'message_2',
          role: 'assistant',
          content: 'The roadmap focuses on ingestion, retrieval, and grounded chat milestones.',
          citations: null,
          toolCalls: null,
          metadata: { activeAgentName: 'GeneralAssistantAgent' },
          createdAt: '2026-07-06T00:00:05.000Z',
          updatedAt: '2026-07-06T00:00:05.000Z',
        },
      ],
      conversation_2: [
        {
          id: 'message_3',
          role: 'assistant',
          content: 'The seeded corpus includes Transformer and Cymbal Starlight documents.',
          citations: null,
          toolCalls: null,
          metadata: { activeAgentName: 'DocumentAgent' },
          createdAt: '2026-07-05T23:55:10.000Z',
          updatedAt: '2026-07-05T23:55:10.000Z',
        },
      ],
      conversation_3: [],
    };

    await json(route, {
      items: conversationId ? messageMap[conversationId] ?? [] : [],
      total: conversationId ? (messageMap[conversationId] ?? []).length : 0,
      page: 1,
      pageSize: 100,
      order: 'asc',
    });
  });
}

test('creates, renames, filters, and deletes conversations from the sidebar', async ({ page }) => {
  await mockConversationApis(page);
  await page.goto('/');

  await expect(page.getByText('Roadmap review')).toBeVisible();
  await expect(page.getByText('The roadmap focuses on ingestion, retrieval, and grounded chat milestones.')).toBeVisible();

  await page.getByRole('button', { name: 'New Chat' }).click();
  const renameNewChatButton = page.getByRole('button', { name: 'Rename conversation New Chat' });
  await expect(renameNewChatButton).toBeVisible();

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('prompt');
    await dialog.accept('Renamed strategy notes');
  });
  await renameNewChatButton.click();
  await expect(page.getByText('Renamed strategy notes')).toBeVisible();

  await page.getByLabel('Search conversations').fill('strategy');
  await expect(page.getByText('Renamed strategy notes')).toBeVisible();
  await expect(page.getByText('Roadmap review')).not.toBeVisible();

  await page.getByLabel('Search conversations').fill('');
  await page.getByRole('button', { name: 'Delete conversation Seeded corpus follow-up' }).click();
  await expect(page.getByText('Seeded corpus follow-up')).not.toBeVisible();
});
