import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ data }),
  });
}

async function mockHomeApis(page: Page) {
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
}

test('home page renders the command center shell', async ({ page }) => {
  await mockHomeApis(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'LocalRAG' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Private document intelligence' })).toBeVisible();
});
