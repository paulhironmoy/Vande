import { test, expect } from '@playwright/test';
import { installClock } from './helpers';

/**
 * Daily Quick Play: Home → one tap → cold open → first choice in < 30 s → official result → practice.
 * Requires the lead's store implementation of startDailyQuickPlay/beginDailyPlay/official records.
 */
test.describe('daily quick play', () => {
  test('one tap from home to the cold open, first choice within 30 s, official then practice', async ({ page }) => {
    test.setTimeout(240_000);
    await installClock(page);
    await page.goto('/home');
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
    const cta = page.getByTestId('daily-play-today');
    await expect(cta).toBeVisible();
    await expect(page.getByTestId('daily-state-line')).toContainText(/Not started/i);
    await cta.click();

    const open = page.getByTestId('daily-open-screen');
    await expect(open).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('daily-open-start')).toBeVisible();
    await expect(page.getByTestId('daily-open-skip')).toBeVisible();

    // Cold open must not hold the player: Start works immediately.
    const t0 = Date.now();
    await page.getByTestId('daily-open-start').click();
    await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
    // First meaningful choice: at most 25 s of game clock at the relaxed pace.
    await page.clock.fastForward(25_000);
    await expect(page.locator('[data-testid^="decision-option-"]:visible').first()).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - t0).toBeLessThan(30_000);

    // Play to the end choosing first options.
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (await page.getByTestId('final-result-screen').isVisible().catch(() => false)) break;
      if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) {
        await page.getByTestId('chapter-continue').click();
        continue;
      }
      const rights = page.getByTestId('rights-moment');
      if (await rights.isVisible().catch(() => false)) {
        const opt = rights.locator('[data-testid^="rights-option-"]').first();
        if (await opt.isVisible().catch(() => false)) await opt.click();
        const cont = page.getByTestId('rights-continue');
        if (await cont.isVisible().catch(() => false)) await cont.click();
        continue;
      }
      const options = page.locator('[data-testid^="decision-option-"]:visible');
      if ((await options.count()) > 0) {
        await options.first().click();
        await page.waitForTimeout(40);
        continue;
      }
      await page.clock.fastForward(10_000);
      await page.waitForTimeout(30);
    }
    await expect(page.getByTestId('final-result-screen')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('daily-result')).toBeVisible();
    await expect(page.getByTestId('daily-official-label')).toBeVisible();
    await expect(page.getByTestId('fingerprint-glyphs')).toBeVisible();
    const officialScore = await page.getByTestId('daily-score').innerText();

    // Calendar shows today as official.
    await page.getByTestId('daily-calendar').click();
    await expect(page.getByTestId('calendar-screen')).toBeVisible();
    const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    await expect(page.getByTestId(`calendar-day-${today}`)).toHaveAttribute('data-state', 'official');

    // Second completion is practice and keeps the official result.
    await page.goto('/home');
    await expect(page.getByTestId('daily-state-line')).toContainText(/Official result|Done today/i);
    await page.getByTestId('daily-play-today').click();
    await expect(page.getByTestId('daily-open-screen')).toBeVisible();
    await page.getByTestId('daily-open-skip').click();
    await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
    const deadline2 = Date.now() + 180_000;
    while (Date.now() < deadline2) {
      if (await page.getByTestId('final-result-screen').isVisible().catch(() => false)) break;
      if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) {
        await page.getByTestId('chapter-continue').click();
        continue;
      }
      const rights = page.getByTestId('rights-moment');
      if (await rights.isVisible().catch(() => false)) {
        const opt = rights.locator('[data-testid^="rights-option-"]').last();
        if (await opt.isVisible().catch(() => false)) await opt.click();
        const cont = page.getByTestId('rights-continue');
        if (await cont.isVisible().catch(() => false)) await cont.click();
        continue;
      }
      const options = page.locator('[data-testid^="decision-option-"]:visible');
      if ((await options.count()) > 0) {
        await options.last().click();
        await page.waitForTimeout(40);
        continue;
      }
      await page.clock.fastForward(10_000);
      await page.waitForTimeout(30);
    }
    await expect(page.getByTestId('daily-practice-label')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('daily-official-kept')).toContainText(officialScore.replace(/\D/g, '').slice(0, 3) || officialScore);
  });

  test('rules cheatsheet is one tap away on the intro, the cold open and during play', async ({ page }) => {
    await installClock(page);
    await page.goto('/');
    await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
    const card = page.getByTestId('rules-card');
    await expect(card).toBeVisible();
    await expect(card.locator('li')).toHaveCount(7);
    await page.getByTestId('intro-begin').click();
    // Cold open: rules one tap away, then straight into play.
    await expect(page.getByTestId('daily-open-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('daily-open-rules').click();
    await expect(page.getByTestId('rules-card').last()).toBeVisible();
    await page.keyboard.press('Escape');
    // The cold open auto-starts after a few seconds; start explicitly only if it is still showing.
    const start = page.getByTestId('daily-open-start');
    if (await start.isVisible().catch(() => false)) await start.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('rules-button').click();
    await expect(page.getByTestId('rules-sheet')).toBeVisible();
    await expect(page.getByTestId('rules-sheet').getByTestId('rules-card').locator('li')).toHaveCount(7);
  });
});
