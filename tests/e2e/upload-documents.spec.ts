import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

async function mockUploadApis(page: Page) {
  let uploaded = false;

  await page.route('**/api/health', (route) =>
    json(route, {
      status: 'healthy',
      checkedAt: '2026-07-06T00:00:00.000Z',
      version: '0.1.0',
      uptimeSeconds: 120,
      checks: [{ name: 'app', status: 'healthy', message: 'Application healthy.', latencyMs: 2 }],
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
      items: [],
      total: 0,
      page: 1,
      pageSize: 100,
      order: 'asc',
    }),
  );

  await page.route('**/api/settings', (route) =>
    json(route, {
      theme: 'system',
      model: 'gpt-4.1-mini',
      showReasoningMetadata: true,
    }),
  );

  await page.route('**/api/upload', async (route) => {
    uploaded = true;
    await json(route, {
      uploadId: 'upload_1',
      documentId: 'document_1',
      workflowExecutionId: 'workflow_1',
      status: 'RUNNING',
      reconciliationRequired: false,
    });
  });

  await page.route('**/api/uploads', (route) =>
    json(
      route,
      uploaded
        ? [
            {
              id: 'upload_1',
              status: 'COMPLETED',
              originalFilename: 'launch-plan.txt',
              mimeType: 'text/plain',
              fileSizeBytes: 24,
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:00:03.000Z',
              errorMessage: null,
            },
          ]
        : [],
    ),
  );

  await page.route('**/api/documents**', (route) =>
    json(route, {
      items: uploaded
        ? [
            {
              id: 'document_1',
              uploadId: 'upload_1',
              status: 'READY',
              title: 'Launch Plan',
              originalFilename: 'launch-plan.txt',
              mimeType: 'text/plain',
              fileSizeBytes: 24,
              chunkCount: 1,
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:00:03.000Z',
              deletedAt: null,
            },
          ]
        : [],
      total: uploaded ? 1 : 0,
      page: 1,
      pageSize: 40,
    }),
  );

  await page.route('**/api/workflows**', (route) =>
    json(route, {
      items: uploaded
        ? [
            {
              id: 'workflow_1',
              workflowKey: 'ingestion',
              status: 'SUCCESS',
              errorMessage: null,
              createdAt: '2026-07-06T00:00:00.000Z',
              updatedAt: '2026-07-06T00:00:03.000Z',
              startedAt: '2026-07-06T00:00:00.000Z',
              completedAt: '2026-07-06T00:00:03.000Z',
              uploadId: 'upload_1',
              documentId: 'document_1',
              reconciliationRequired: false,
            },
          ]
        : [],
      total: uploaded ? 1 : 0,
    }),
  );
}

test('uploads a document and surfaces it in the knowledge base', async ({ page }) => {
  await mockUploadApis(page);
  await page.goto('/');

  await expect(page.getByText('No files in the upload queue.')).toBeVisible();

  await page.getByLabel('Browse files').setInputFiles({
    name: 'launch-plan.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('launch-plan contents', 'utf8'),
  });

  const uploadSection = page
    .getByRole('heading', { name: 'Upload documents' })
    .locator('xpath=ancestor::section[1]');
  const documentLibrarySection = page
    .getByRole('heading', { name: 'Document library' })
    .locator('xpath=ancestor::section[1]');
  const queueItem = uploadSection.locator('article').filter({ hasText: 'launch-plan.txt' });
  const documentCard = documentLibrarySection.locator('article').filter({ hasText: 'Launch Plan' });
  await expect(queueItem).toContainText('success');
  await expect(documentCard).toContainText('Launch Plan');
  await expect(documentCard).toContainText('launch-plan.txt');
  await expect(documentCard).toContainText('1 chunk');

  await page.getByPlaceholder('Search documents').fill('Launch');
  await expect(documentCard).toContainText('Launch Plan');
  await expect(documentCard).toContainText('launch-plan.txt');
});

test('rejects unsupported file types before network upload', async ({ page }) => {
  await mockUploadApis(page);
  await page.goto('/');

  await page.getByLabel('Browse files').setInputFiles({
    name: 'malware.exe',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('boom', 'utf8'),
  });

  const queueItem = page.locator('article').filter({ hasText: 'malware.exe' }).first();
  await expect(queueItem).toContainText('Unsupported file type.');
  await expect(queueItem).toContainText('error');
});
