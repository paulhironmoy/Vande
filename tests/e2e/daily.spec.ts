import { test, expect } from '@playwright/test';

test('daily challenge is deterministic for the calendar day and labels the simulated range', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-23T10:00:00') });
  await page.goto('/daily');
  await expect(page.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-date')).toContainText(/2026/);
  const text1 = await page.getByTestId('daily-screen').innerText();
  expect(text1).toMatch(/Simulated range — not real players/);

  const page2 = await context.newPage();
  await page2.clock.install({ time: new Date('2026-10-23T18:00:00') });
  await page2.goto('/daily');
  await expect(page2.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  const text2 = await page2.getByTestId('daily-screen').innerText();
  expect(text2).toBe(text1);

  await page.getByTestId('daily-play').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
});
