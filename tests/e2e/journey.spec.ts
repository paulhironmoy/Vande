import { test, expect } from '@playwright/test';
import { confirmOpponentsAndStart, enterGameplayFresh, installClock, playChapterToEnd } from './helpers';

test.describe('Critical journey', () => {
  test('first-time player reaches gameplay in two taps after the intro and completes all three chapters', async ({ page }) => {
    test.setTimeout(420_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await installClock(page);
    await enterGameplayFresh(page);

    await expect(page.getByTestId('timer')).toBeVisible();
    await expect(page.getByTestId('pulse')).toBeVisible();
    await expect(page.getByTestId('map')).toBeVisible();

    for (let chapter = 1; chapter <= 3; chapter++) {
      await playChapterToEnd(page);
      if (chapter < 3) {
        await expect(page.getByTestId('chapter-result-screen')).toBeVisible();
        await expect(page.getByTestId('chapter-score')).toBeVisible();
        await page.getByTestId('chapter-continue').click();
        await expect(page.getByTestId('briefing-screen')).toBeVisible();
        await page.getByTestId('briefing-start').click();
        await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
      }
    }

    // Last chapter result → final result
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) {
      await page.getByTestId('chapter-continue').click();
    }
    await expect(page.getByTestId('final-result-screen')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('final-score')).toBeVisible();
    await expect(page.getByTestId('final-outcome')).toBeVisible();
    const scoreText = await page.getByTestId('final-score').innerText();
    expect(scoreText).toMatch(/\d+/);

    await page.getByTestId('final-home').click();
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await expect(page.getByTestId('home-personal-best')).toBeVisible();

    const realErrors = errors.filter((e) => !/favicon|manifest|ServiceWorker|service worker|WebGL|GPU|Download the React DevTools/i.test(e));
    expect(realErrors, realErrors.join('\n')).toEqual([]);
  });

  test('returning player: home → start → opponents → briefing → play (two taps to begin)', async ({ page }) => {
    await installClock(page);
    await page.goto('/');
    await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('intro-begin').click();
    await expect(page.getByTestId('opponents-screen')).toBeVisible();
    await page.goto('/home');
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await page.getByTestId('home-start-campaign').click();
    await confirmOpponentsAndStart(page);
  });
});
