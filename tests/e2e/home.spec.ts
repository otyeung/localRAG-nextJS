import { expect, test } from '@playwright/test';

test('home page renders the bootstrap experience', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'LocalRAG' })).toBeVisible();
  await expect(page.getByText('Enterprise RAG foundation')).toBeVisible();
});
