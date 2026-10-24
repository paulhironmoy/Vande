import { test, expect } from '@playwright/test';
import { installClock, playChapterToEnd, readNumber } from './helpers';

test('today’s crisis: one tap from Home, official first result, practice afterwards, calendar and history updated', async ({ page }) => {
  test.setTimeout(300_000);
  await installClock(page);
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-state-line')).toContainText(/Not started|Play/i);

  // One tap → cold open → play (no opponent setup, no long briefing).
  const t0 = Date.now();
  await page.getByTestId('daily-play-today').click();
  await expect(page.getByTestId('daily-open-screen')).toBeVisible();
  await page.getByTestId('daily-open-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await page.clock.fastForward(9_000);
  await expect(page.locator('[data-testid^="decision-option-"]:visible').first()).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - t0).toBeLessThan(30_000);

  await playChapterToEnd(page);
  if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) await page.getByTestId('chapter-continue').click();
  await expect(page.getByTestId('final-result-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-result')).toBeVisible();
  await expect(page.getByTestId('daily-official-label')).toBeVisible();
  await expect(page.getByTestId('final-result-screen')).not.toContainText(/Simulated range/);
  const official = await readNumber(page, 'daily-score');

  // Launcher and calendar reflect the official result.
  await page.goto('/daily');
  await expect(page.getByTestId('daily-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-state')).toContainText(String(official));
  await page.goto('/calendar');
  await expect(page.getByTestId('calendar-screen')).toBeVisible({ timeout: 15_000 });
  const today = new Date('2026-10-23T10:00:00').toISOString().slice(0, 10);
  await expect(page.locator(`[data-testid="calendar-day-${today}"]`)).toHaveAttribute('data-state', /official|today/);

  // A second run is practice and cannot change the official score.
  await page.goto('/daily');
  await page.getByTestId('daily-play').click();
  await expect(page.getByTestId('daily-open-screen')).toBeVisible();
  await page.getByTestId('daily-open-skip').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await playChapterToEnd(page);
  if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) await page.getByTestId('chapter-continue').click();
  await expect(page.getByTestId('final-result-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('daily-practice-label')).toBeVisible();
  await page.goto('/daily');
  await expect(page.getByTestId('daily-state')).toContainText(String(official));

  await page.goto('/history');
  await expect(page.getByTestId('history-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('history-screen')).toContainText(/Practice/);
});
