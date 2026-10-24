import { test, expect, type Page } from '@playwright/test';

/**
 * Visual QA capture (not part of the default run). Produces screenshots of every screen at two sizes.
 * Run: VISUAL=1 npx playwright test --project=visual
 */
const SIZES = [
  { name: 'phone-simple', width: 390, height: 844, style: 'simple' },
  { name: 'desktop-simple', width: 1440, height: 900, style: 'simple' },
  { name: 'phone-full', width: 390, height: 844, style: 'full' },
  { name: 'desktop-full', width: 1440, height: 900, style: 'full' },
] as const;

async function shot(page: Page, name: string, size: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `test-results-visual/shots/${name}-${size}.png`, fullPage: false });
}

async function playChapter(page: Page) {
  const deadline = Date.now() + 200_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) return;
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
    await page.clock.fastForward(15_000);
    await page.waitForTimeout(30);
  }
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('capture all screens', async ({ page }) => {
      test.setTimeout(600_000);
      await page.clock.install({ time: new Date('2026-10-23T10:00:00') });
      await page.goto('/');
      await expect(page.getByTestId('launch-screen').or(page.getByTestId('intro-screen'))).toBeVisible({ timeout: 15_000 });
      if (await page.getByTestId('launch-screen').isVisible().catch(() => false)) await shot(page, '01-launch', size.name);
      await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
      await shot(page, '02-intro', size.name);
      const chooser = page.getByTestId(`style-${size.style}`);
      if (await chooser.isVisible().catch(() => false)) await chooser.click();
      await page.getByTestId('intro-begin').click();
      await expect(page.getByTestId('opponents-screen')).toBeVisible();
      await shot(page, '03-opponents', size.name);
      await page.getByTestId('opponents-confirm').click();
      await expect(page.getByTestId('briefing-screen')).toBeVisible();
      await page.waitForTimeout(2500);
      await shot(page, '04-briefing', size.name);
      await page.getByTestId('briefing-start').click();
      await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
      await page.clock.fastForward(12_000);
      await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible();
      await shot(page, '05-play-decision', size.name);
      // Evidence tray + detail
      const tray = page.getByTestId('evidence-tray');
      if (!(await tray.isVisible().catch(() => false))) await page.getByTestId('evidence-tray-toggle').click();
      await expect(tray).toBeVisible();
      await shot(page, '06-evidence-list', size.name);
      await page.locator('[data-testid^="evidence-card-"]').first().click();
      await expect(page.getByTestId('evidence-detail')).toBeVisible();
      await shot(page, '07-evidence-detail', size.name);
      const inspect = page.getByTestId('evidence-action-inspect');
      if (await inspect.isVisible().catch(() => false)) {
        await inspect.click();
        await shot(page, '08-evidence-inspected', size.name);
      }
      await page.getByTestId('evidence-back').click();
      if (size.name === 'phone') {
        const close = page.getByRole('button', { name: /close/i }).first();
        if (await close.isVisible().catch(() => false)) await close.click();
      }
      // Pulse values
      await page.getByTestId('pulse').first().click();
      await shot(page, '09-pulse-values', size.name);
      await page.keyboard.press('Escape');
      // Decide → feedback strip
      const option = page.locator('[data-testid^="decision-option-"]:visible').first();
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        await shot(page, '10-feedback', size.name);
      }
      // Map district card
      await page.getByTestId('map-district-civic').click();
      await shot(page, '11-district', size.name);
      await page.keyboard.press('Escape');
      // Pause sheet
      await page.getByTestId('pause').click();
      await shot(page, '12-pause', size.name);
      await page.getByTestId('resume').click();
      // Later in the chapter: more pressure
      await page.clock.fastForward(60_000);
      await page.waitForTimeout(100);
      await shot(page, '13-play-mid', size.name);
      // Rights moment if any shows up while playing to end
      await playChapter(page);
      await expect(page.getByTestId('chapter-result-screen')).toBeVisible();
      await shot(page, '14-chapter-result', size.name);
      await page.getByTestId('chapter-continue').click();
      await expect(page.getByTestId('briefing-screen')).toBeVisible();
      await page.getByTestId('briefing-start').click();
      await playChapter(page);
      await page.getByTestId('chapter-continue').click();
      await expect(page.getByTestId('briefing-screen')).toBeVisible();
      await shot(page, '15-briefing-ch3', size.name);
      await page.getByTestId('briefing-start').click();
      await playChapter(page);
      await page.getByTestId('chapter-continue').click();
      await expect(page.getByTestId('final-result-screen')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      await shot(page, '16-final-result', size.name);
      await page.getByTestId('final-challenge').click();
      await expect(page.getByTestId('share-card-preview')).toBeVisible({ timeout: 15_000 });
      await shot(page, '17-share', size.name);
      await page.keyboard.press('Escape');
      await page.getByTestId('final-home').click();
      await expect(page.getByTestId('home-screen')).toBeVisible();
      await shot(page, '18-home-after', size.name);
      await page.getByTestId('home-daily').click();
      await expect(page.getByTestId('daily-screen')).toBeVisible();
      await shot(page, '19-daily', size.name);
      await page.goBack();
      await page.getByTestId('home-republic').click();
      await expect(page.getByTestId('republic-screen')).toBeVisible();
      await shot(page, '20-republic', size.name);
      await page.goto('/history');
      await expect(page.getByTestId('history-screen')).toBeVisible();
      await shot(page, '21-history', size.name);
      await page.goto('/settings');
      await expect(page.getByTestId('settings-screen')).toBeVisible();
      await shot(page, '22-settings', size.name);
      await page.goto('/about/disclosure');
      await expect(page.getByTestId('about-screen')).toBeVisible();
      await shot(page, '23-about', size.name);
      await page.goto('/c/INVALID');
      await expect(page.getByTestId('challenge-screen')).toBeVisible();
      await shot(page, '24-challenge-invalid', size.name);
    });
  });
}
