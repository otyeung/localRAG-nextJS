import { expect, test, type Page, type Route } from '@playwright/test';

type SettingsState = {
  theme: 'system' | 'light' | 'dark';
  model: string;
  showReasoningMetadata: boolean;
};

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

async function mockShellApis(page: Page) {
  let settings: SettingsState = {
    theme: 'system',
    model: 'gpt-4.1-mini',
    showReasoningMetadata: true,
  };

  await page.route('**/api/health', (route) =>
    json(route, {
      status: 'healthy',
      checkedAt: '2026-07-06T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 120,
      checks: [
        { name: 'app', status: 'healthy', message: 'Application healthy.', latencyMs: 3 },
        { name: 'database', status: 'healthy', message: 'Database healthy.', latencyMs: 5 },
      ],
    }),
  );

  await page.route('**/api/conversations**', (route) =>
    json(route, {
      items: [
        {
          id: 'conversation_1',
          title: 'Transformer notes',
          status: 'ACTIVE',
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:00:00.000Z',
          messageCount: 1,
          lastMessagePreview: 'Summarize the seeded corpus.',
          activeAgentName: 'DocumentAgent',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 30,
    }),
  );

  await page.route('**/api/messages**', (route) =>
    json(route, {
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      order: 'asc',
    }),
  );

  await page.route('**/api/documents**', (route) =>
    json(route, {
      items: [
        {
          id: 'document_1',
          uploadId: 'upload_1',
          status: 'READY',
          title: 'Attention Is All You Need',
          originalFilename: '1706.03762v7.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          chunkCount: 12,
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:00:00.000Z',
          deletedAt: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 40,
    }),
  );

  await page.route('**/api/workflows**', (route) =>
    json(route, {
      items: [
        {
          id: 'workflow_1',
          workflowKey: 'ingestion',
          status: 'SUCCESS',
          errorMessage: null,
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:00:00.000Z',
          startedAt: '2026-07-06T00:00:00.000Z',
          completedAt: '2026-07-06T00:00:03.000Z',
          uploadId: 'upload_1',
          documentId: 'document_1',
          reconciliationRequired: false,
        },
      ],
      total: 1,
    }),
  );

  await page.route('**/api/uploads', (route) =>
    json(route, []),
  );

  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'PATCH') {
      settings = {
        ...settings,
        ...(route.request().postDataJSON() as Partial<SettingsState>),
      };
    }

    await json(route, settings);
  });
}

test('loads the app shell, opens panels, and applies theme changes through settings', async ({ page }) => {
  await mockShellApis(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'LocalRAG' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Knowledge Base' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System Status' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Upload documents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Document library' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  const themeMode = page.getByLabel('Theme mode');
  await themeMode.selectOption('dark');
  await expect(page.locator('html')).toHaveClass(/dark/);

  await themeMode.selectOption('light');
  await expect(page.locator('html')).not.toHaveClass(/dark/);

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Saved')).toBeVisible();

  await page.getByRole('button', { name: 'Knowledge Base' }).click();
  await expect(page.getByRole('heading', { name: 'Upload documents' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'System Status' })).toBeVisible();
});
