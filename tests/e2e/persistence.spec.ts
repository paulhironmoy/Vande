import { test, expect } from '@playwright/test';
import { enterGameplayFresh, installClock, openEvidenceTray } from './helpers';

test('refresh during gameplay restores the chapter at the same point with open evidence context', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.clock.fastForward(25_000);
  const before = await page.getByTestId('timer').innerText();
  // Open the tray and an evidence card, then refresh.
  await openEvidenceTray(page);
  const firstCard = page.locator('[data-testid^="evidence-card-"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(page.getByTestId('evidence-detail')).toBeVisible();
  await page.waitForTimeout(600); // allow debounced persistence
  await page.reload();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('evidence-detail')).toBeVisible();
  const after = await page.getByTestId('timer').innerText();
  // The game pauses on reload; the timer should be within a few seconds of where it was.
  const toSec = (t: string) => {
    const [m, s] = t.trim().split(':').map(Number);
    return m * 60 + s;
  };
  expect(Math.abs(toSec(before) - toSec(after))).toBeLessThanOrEqual(5);
});

test('continue campaign from home after leaving mid-chapter', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.clock.fastForward(15_000);
  await page.goto('/home');
  await expect(page.getByTestId('home-continue')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-continue').click();
  await expect(page.getByTestId('play-screen').or(page.getByTestId('briefing-screen'))).toBeVisible();
});

test('export and delete local progress from settings', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('settings-export')).toBeVisible();
  await expect(page.getByTestId('settings-delete')).toBeVisible();
  await expect(page.getByTestId('settings-export')).toContainText(/Save a copy of my progress|Export local progress/);
});
