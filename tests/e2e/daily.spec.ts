import { test, expect } from '@playwright/test';

test('the daily launcher is deterministic for the UTC day, shows reset timing and never fabricates community numbers', async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-24T10:00:00Z') });
  await page.goto('/daily');
  await expect(page.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-date')).toHaveAttribute('datetime', /^2026-/);
  const text1 = await page.getByTestId('daily-screen').innerText();
  expect(text1).not.toMatch(/Simulated range/);
  // Community numbers only come from real submissions; with the API disabled the slot says so.
  await expect(page.getByTestId('community-slot')).toContainText(/Not enough results yet|Community results/i);

  const page2 = await context.newPage();
  await page2.clock.install({ time: new Date('2026-10-24T18:00:00Z') });
  await page2.goto('/daily');
  await expect(page2.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  const text2 = await page2.getByTestId('daily-screen').innerText();
  expect(text2.replace(/\d+h \d+m|\d+ ?min/g, 'T')).toBe(text1.replace(/\d+h \d+m|\d+ ?min/g, 'T'));

  await page.getByTestId('daily-play').click();
  await expect(page.getByTestId('daily-open-screen')).toBeVisible();
  await expect(page.getByTestId('daily-open-start')).toBeVisible();
});
