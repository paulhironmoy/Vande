import { test, expect } from '@playwright/test';
import { VIEWPORTS, assertControlsReachable, assertNoHorizontalOverflow, chooseStyle, installClock, openEvidenceTray } from './helpers';

for (const vp of VIEWPORTS) {
  test.describe(`viewport ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('home, opponents, briefing, play and settings have no overflow and reachable controls', async ({ page }) => {
      await installClock(page);
      await page.goto('/');
      await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
      await assertNoHorizontalOverflow(page);
      await assertControlsReachable(page, ['intro-begin']);
      await page.getByTestId('intro-begin').click();
      await expect(page.getByTestId('daily-open-screen')).toBeVisible({ timeout: 15_000 });
      await assertNoHorizontalOverflow(page);
      await assertControlsReachable(page, ['daily-open-start', 'daily-open-skip']);
      await page.goto('/home');
      await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('home-start-campaign').click();

      await expect(page.getByTestId('opponents-screen')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertControlsReachable(page, ['opponents-confirm', 'opponent-toggle-exploiter', 'difficulty-standard']);
      await page.getByTestId('opponents-confirm').click();

      await expect(page.getByTestId('briefing-screen')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertControlsReachable(page, ['briefing-start', 'briefing-skip']);
      await page.getByTestId('briefing-start').click();

      await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
      await assertNoHorizontalOverflow(page);
      await assertControlsReachable(page, ['timer', 'pulse', 'map', 'pause', 'evidence-tray-toggle']);
      await page.clock.fastForward(12_000);
      await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible({ timeout: 10_000 });
      await assertNoHorizontalOverflow(page);
      const firstOption = page.locator('[data-testid^="decision-option-"]:visible').first();
      await expect(firstOption).toBeVisible();
      const box = await firstOption.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
      await page.screenshot({ path: `test-results/screens/play-${vp.name}.png` });

      await openEvidenceTray(page);
      await assertNoHorizontalOverflow(page);
      await page.screenshot({ path: `test-results/screens/evidence-${vp.name}.png` });

      await page.goto('/home');
      await expect(page.getByTestId('home-screen')).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertControlsReachable(page, ['home-continue', 'home-daily', 'home-settings']);
      await page.screenshot({ path: `test-results/screens/home-${vp.name}.png` });

      await page.goto('/settings');
      await expect(page.getByTestId('settings-screen')).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });
  });
}

// The Full (strategist) presentation must also fit the narrowest phone.
test.describe('viewport 360x800 · Full style', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('opponents, briefing and play fit without overflow', async ({ page }) => {
    await installClock(page);
    await page.goto('/');
    await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
    await chooseStyle(page, 'full');
    await page.getByTestId('intro-begin').click();
    await expect(page.getByTestId('daily-open-screen')).toBeVisible({ timeout: 15_000 });
    await assertNoHorizontalOverflow(page);
    await page.goto('/home');
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('home-start-campaign').click();
    await expect(page.getByTestId('opponents-screen')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByTestId('opponents-confirm').click();
    await expect(page.getByTestId('briefing-screen')).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByTestId('briefing-start').click();
    await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
    await page.clock.fastForward(12_000);
    await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible({ timeout: 10_000 });
    await assertNoHorizontalOverflow(page);
    await assertControlsReachable(page, ['timer', 'pulse', 'map', 'pause', 'evidence-tray-toggle']);
  });
});
