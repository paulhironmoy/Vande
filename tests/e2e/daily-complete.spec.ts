import { test, expect } from '@playwright/test';
import { continueToFinalResult, installClock, playChapterToEnd, readNumber } from './helpers';

test('today’s crisis can be completed; the result is recorded for the day and listed in history', async ({ page }) => {
  test.setTimeout(240_000);
  await installClock(page);
  await page.goto('/daily');
  await expect(page.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-screen')).toContainText(/Not played yet/);
  await page.getByTestId('daily-play').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });

  await playChapterToEnd(page);
  await continueToFinalResult(page);
  const result = page.getByTestId('final-result-screen');
  await expect(result).toContainText('Simulated range — not real players');
  const score = await readNumber(page, 'final-score');

  await page.goto('/daily');
  await expect(page.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-screen')).not.toContainText(/Not played yet/);
  await expect(page.getByTestId('daily-screen')).toContainText(String(score));

  await page.goto('/history');
  await expect(page.getByTestId('history-screen')).toBeVisible({ timeout: 15_000 });
  const entries = page.locator('[data-testid^="history-entry-"]');
  await expect(entries.first()).toBeVisible();
  await expect(page.getByTestId('history-screen')).toContainText(/Daily/i);
});
