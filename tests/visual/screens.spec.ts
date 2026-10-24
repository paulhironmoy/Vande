import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Visual QA capture (not part of the default run). Produces screenshots of every screen in both play styles
 * at phone and desktop sizes. Run: VISUAL=1 npx playwright test --project=visual
 */
const SIZES = [
  { name: 'phone-simple', width: 390, height: 844, style: 'simple' },
  { name: 'desktop-simple', width: 1440, height: 900, style: 'simple' },
  { name: 'phone-full', width: 390, height: 844, style: 'full' },
  { name: 'desktop-full', width: 1440, height: 900, style: 'full' },
] as const;

type Size = (typeof SIZES)[number];

async function shot(page: Page, name: string, size: string) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `test-results-visual/shots/${name}-${size}.png`, fullPage: false });
}

/** Clicks when visible; never throws (sheets, auto-pause and style differences make some steps optional). */
async function safeClick(loc: Locator, timeout = 2500): Promise<boolean> {
  try {
    if (!(await loc.isVisible().catch(() => false))) return false;
    await loc.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

const isPhone = (size: Size) => size.width < 1024;

/** Closes any open play sheet (evidence, pulse, pause) so the map and status bar are clickable again. */
async function closeSheets(page: Page) {
  for (let i = 0; i < 3; i++) {
    const closeBtn = page.locator('[data-testid="evidence-tray"] button[aria-label], [data-testid="pulse-sheet"] button[aria-label], [data-testid="pause-sheet"] button[aria-label]').filter({ hasText: '' }).first();
    const anySheet = page.locator('[data-testid="evidence-tray"]:visible, [data-testid="pulse-sheet"]:visible, [data-testid="pause-sheet"]:visible');
    if ((await anySheet.count()) === 0) return;
    const resume = page.getByTestId('resume');
    if (await safeClick(resume)) continue;
    if (!(await safeClick(closeBtn))) await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

/** Answers a pending rights moment if one is on screen; takes a shot the first time. */
async function settleRights(page: Page, size: Size, state: { rightsShot: boolean }): Promise<boolean> {
  const rights = page.getByTestId('rights-moment');
  if (!(await rights.isVisible().catch(() => false))) return false;
  if (!state.rightsShot) {
    await shot(page, '13a-rights-moment', size.name);
  }
  const opt = rights.locator('[data-testid^="rights-option-"]').first();
  await safeClick(opt);
  if (!state.rightsShot) {
    await shot(page, '13b-rights-explained', size.name);
    state.rightsShot = true;
  }
  await safeClick(page.getByTestId('rights-continue'));
  return true;
}

async function playChapter(page: Page, size: Size, state: { rightsShot: boolean }) {
  const deadline = Date.now() + 200_000;
  while (Date.now() < deadline) {
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) return;
    if (await settleRights(page, size, state)) continue;
    const options = page.locator('[data-testid^="decision-option-"]:visible');
    if ((await options.count()) > 0) {
      await safeClick(options.first());
      await page.waitForTimeout(40);
      continue;
    }
    await page.clock.fastForward(15_000);
    await page.waitForTimeout(30);
  }
  throw new Error('chapter did not finish');
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('capture all screens', async ({ page }) => {
      test.setTimeout(600_000);
      const state = { rightsShot: false };
      await page.clock.install({ time: new Date('2026-10-23T10:00:00') });
      await page.goto('/');
      await expect(page.getByTestId('launch-screen').or(page.getByTestId('intro-screen'))).toBeVisible({ timeout: 15_000 });
      if (await page.getByTestId('launch-screen').isVisible().catch(() => false)) await shot(page, '01-launch', size.name);
      await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
      await shot(page, '02-intro', size.name);
      await safeClick(page.getByTestId(`style-${size.style}`));
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
      if (await page.getByTestId('clock-waiting').isVisible().catch(() => false)) {
        await shot(page, '05b-clock-waiting', size.name);
      }

      // Evidence tray + detail
      const tray = page.getByTestId('evidence-tray');
      if (!(await tray.isVisible().catch(() => false))) await page.getByTestId('evidence-tray-toggle').click();
      await expect(tray).toBeVisible();
      await shot(page, '06-evidence-list', size.name);
      await page.locator('[data-testid^="evidence-card-"]').first().click();
      await expect(page.getByTestId('evidence-detail')).toBeVisible();
      await shot(page, '07-evidence-detail', size.name);
      if (await safeClick(page.getByTestId('evidence-action-inspect'))) {
        await shot(page, '08-evidence-inspected', size.name);
      }
      await safeClick(page.getByTestId('evidence-back'));
      if (isPhone(size)) await closeSheets(page);

      // Pulse values (phone: sheet; desktop: rail panel)
      await safeClick(page.getByTestId('pulse').first());
      await shot(page, '09-pulse-values', size.name);
      if (isPhone(size)) await closeSheets(page);
      else await page.keyboard.press('Escape');

      // Decide → feedback strip
      const option = page.locator('[data-testid^="decision-option-"]:visible').first();
      if (await safeClick(option)) {
        await shot(page, '10-feedback', size.name);
      }
      await settleRights(page, size, state);

      // Map district card
      await safeClick(page.getByTestId('map-district-civic'));
      await shot(page, '11-district', size.name);
      await page.keyboard.press('Escape');

      // Pause sheet (only reachable while the clock runs; in Simple the clock may be waiting)
      if (await page.getByTestId('clock-waiting').isVisible().catch(() => false)) {
        await safeClick(page.locator('[data-testid^="decision-option-"]:visible').first());
        await settleRights(page, size, state);
      }
      if (await safeClick(page.getByTestId('pause'))) {
        if (await page.getByTestId('resume').isVisible().catch(() => false)) {
          await shot(page, '12-pause', size.name);
          await safeClick(page.getByTestId('resume'));
        }
      }

      // Later in the chapter: more pressure
      await page.clock.fastForward(60_000);
      await page.waitForTimeout(100);
      await shot(page, '13-play-mid', size.name);

      await playChapter(page, size, state);
      await expect(page.getByTestId('chapter-result-screen')).toBeVisible();
      await shot(page, '14-chapter-result', size.name);
      await page.getByTestId('chapter-continue').click();
      await expect(page.getByTestId('briefing-screen')).toBeVisible();
      await page.getByTestId('briefing-start').click();
      await playChapter(page, size, state);
      await page.getByTestId('chapter-continue').click();
      await expect(page.getByTestId('briefing-screen')).toBeVisible();
      await shot(page, '15-briefing-ch3', size.name);
      await page.getByTestId('briefing-start').click();
      await playChapter(page, size, state);
      await page.getByTestId('chapter-continue').click();
      await expect(page.getByTestId('final-result-screen')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1200);
      await shot(page, '16-final-result', size.name);
      await page.getByTestId('final-challenge').click();
      await expect(page.getByTestId('share-card-preview')).toBeVisible({ timeout: 15_000 });
      await shot(page, '17-share', size.name);
      await page.keyboard.press('Escape');
      await safeClick(page.getByTestId('final-home'));
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
